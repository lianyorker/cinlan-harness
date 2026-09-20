import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import { recordFeedback } from '@deepseek-ai/dsh-command-feedback'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import MessageFeedbackService from '../src/index.ts'
import { appendMessageFixture } from './helpers.ts'

let root: string | undefined
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})
async function loadComposition(configPath: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root as string).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
    ['@deepseek-ai/dsh-message-feedback', MessageFeedbackService],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  const unloaded = [...ctx.loader.entries()]
    .filter(entry => entry.fiber === undefined && !entry.disabled)
    .map(entry => entry.options.name)
  expect(unloaded).toEqual([])
  return ctx
}

describe('message feedback through a real Loader composition', () => {
  it.each([undefined, 'task-result'] as const)('reopens native v3 feedback with category %s across live and cold operations', async (category) => {
    root = await mkdtemp(join(tmpdir(), 'dsh-message-feedback-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-persistence-jsonl'",
      '  config:',
      `    root: ${JSON.stringify(join(root, 'sessions'))}`,
      '    compression: none',
      "- name: '@deepseek-ai/dsh-message-feedback'",
      '  config:',
      '    maxNoteBytes: 32',
      '',
    ].join('\n'))

    const first = await loadComposition(configPath)
    expect(first.messageFeedback.typertRemote.namespace).toBe('messageFeedback')
    expect(remoteMethods(first.messageFeedback).map(marker => marker.method))
      .toEqual(['list', 'put', 'delete'])

    const unowned = first.sessions.create(SessionId('unowned-feedback'))
    const unownedFixture = appendMessageFixture(unowned)
    const unownedRequest = {
      sessionId: unowned.id, messageId: unownedFixture.assistantMessageIds[0], rating: 'positive' as const, ifVersion: null,
    }
    // A mounted JSONL listener alone does not persist Sessions without a write handle.
    await expect(first.messageFeedback.put(unownedRequest)).rejects.toThrow(/not found/u)
    expect(await first.sessionPersistence.stat(unowned.id)).toBeUndefined()
    const unownedItems = await first.messageFeedback.list({ sessionId: unowned.id })
    if (!unownedItems.ok) throw new Error(unownedItems.error.code)
    await expect(first.messageFeedback.put({ ...unownedRequest, ifVersion: unownedItems.value.items[0]!.version }))
      .rejects.toThrow(/not found/u)

    const session = first.sessions.create(SessionId('loader-feedback'), {
      meta: { cwd: root },
    })
    // The mounted backend routes this published session's `session/event`
    // batches and `session/flush` barriers into its active write handle.
    const writeHandle = await first.sessionPersistence.create(session.header)
    const fixture = appendMessageFixture(session)
    const messages = session.deriveMessages()
    const records = [
      { text: 'text without a category' },
      { text: 'categorized remark', category: 'product-interaction' as const },
      { category: 'service-stability' as const },
      {},
    ]
    for (const record of records) recordFeedback(session, record)
    const put = await first.messageFeedback.put({
      sessionId: session.id,
      messageId: fixture.assistantMessageIds[0],
      rating: 'positive',
      note: 'survives restart',
      ...(category === undefined ? {} : { category }),
      ifVersion: null,
    })
    if (!put.ok) throw new Error(`expected put success, got ${put.error.code}`)
    const readHandle = await first.sessionPersistence.open(session.id, 'read')
    const { events: durableEvents } = await readHandle.read()
    await readHandle.close()
    expect(durableEvents.some(event =>
      event.type === 'assistant/message'
      && event.data.message.id === fixture.assistantMessageIds[0])).toBe(true)

    await writeHandle.close()
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const second = await loadComposition(configPath)
    await expect(second.messageFeedback.list({ sessionId: session.id })).resolves.toEqual({
      ok: true,
      value: { items: [put.value] },
    })
    const reopened = await second.sessionPersistence.open(session.id, 'read')
    try {
      const { events, eventState } = await reopened.read()
      expect(reopened.header.version).toBe(3)
      const restored = Session.fromRestore(
        session.id, events, reopened.header, reopened.inheritedEventCount, eventState,
      )
      expect(restored.snapshotEvents().filter(event => event.type === 'feedback/record').map(event => event.data))
        .toEqual(records)
      const feedback = restored.snapshotEvents().find(event => event.type === 'feedback/message-put')
      expect(feedback?.data.item).toEqual(put.value)
      if (category === undefined) expect(feedback?.data.item).not.toHaveProperty('category')
      else expect(feedback?.data.item.category).toBe(category)
      expect(restored.deriveMessages()).toEqual(messages)
    } finally {
      await reopened.close()
    }
    const edited = await second.messageFeedback.put({
      sessionId: session.id,
      messageId: fixture.assistantMessageIds[0],
      rating: 'negative',
      note: 'cold edit',
      ifVersion: put.value.version,
    })
    if (!edited.ok) throw new Error(edited.error.code)
    await second.messageFeedback.delete({ sessionId: session.id, messageId: edited.value.messageId, ifVersion: edited.value.version })
    const coldHandle = await second.sessionPersistence.open(session.id, 'read')
    try {
      const { events: coldEvents } = await coldHandle.read()
      expect(coldEvents.slice(0, durableEvents.length)).toEqual(durableEvents)
      expect(coldEvents.slice(durableEvents.length).map(event => event.type)).toEqual(['feedback/message-put', 'feedback/message-delete'])
    } finally {
      await coldHandle.close()
    }
    expect(second.sessions.get(session.id)).toBeUndefined()
  })
})
