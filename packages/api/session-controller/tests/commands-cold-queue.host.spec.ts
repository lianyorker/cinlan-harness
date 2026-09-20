/** Cold continuable queue mutation through the existing durable single-writer lease. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, MessageId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { subagentIdentityProjectionDefinition } from '@deepseek-ai/dsh-subagent/src/projection.ts'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import { SessionControlController } from '../src/control.ts'
import { SessionObservationReader } from '@deepseek-ai/dsh-session-query/src/observation.ts'

async function harness(mode: 'continuable' | 'one-shot' | 'seed-only' | 'root' = 'continuable', interrupted = false) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cold-queue-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  ctx.sessionProjections.register(subagentIdentityProjectionDefinition)
  const id = SessionId('cold-child')
  const ancestor = Session.create(SessionId('ancestor'))
  ancestor.append('subagent/descriptor', snapshotSubagentDescriptor({ mode: 'continuable', provider: 'test', label: 'ancestor' }))
  const seed = mode === 'seed-only' ? ancestor.snapshotEvents() : undefined
  const session = Session.create(id, seed, {
    version: 3, id, createdAt: 1, cwd: root, isSeeded: seed !== undefined,
    ...(mode === 'root' ? {} : { parentSession: SessionId('parent'), origin: 'subagent' as const }),
  }, seed === undefined ? undefined : SessionLogOffset(seed.length))
  if (mode === 'continuable') session.append('subagent/descriptor',
    snapshotSubagentDescriptor({ mode: 'continuable', provider: 'test', label: 'child' }))
  if (mode === 'one-shot') session.append('subagent/descriptor',
    snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'test', label: 'child' }))
  const message = createUserMessage({ content: [{ type: 'text', text: 'queued cold input' }], source: { kind: 'user' } })
  session.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [message] })
  if (interrupted) {
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
  }
  const writer = await ctx.sessionPersistence.create(session.header, { inheritedEventCount: session.inheritedEventCount })
  try { await writer.append(session.snapshotEvents()); await writer.flush() } finally { await writer.close() }
  const control = new SessionControlController(ctx)
  const publish = vi.fn((...args: Parameters<SessionControlController['publishInbox']>) => { control.publishInbox(...args) })
  const resolveAgent = vi.fn(() => { throw new Error('cold queue mutation must not activate an Agent') })
  const controller = new SessionCommandController(ctx, { resolveAgent } as unknown as ApiSessionAgentController, root, publish)
  const observations = new SessionObservationReader(ctx)
  const observe = () => observations.read(id, { projectionMode: 'all' })
  const read = async () => {
    using observation = await observe()
    const inbox = observation.projections?.values.inbox
    if (inbox === undefined) throw new Error('production mount did not expose the inbox projection')
    return inbox
  }
  return { root, ctx, id, message, controller, publish, control, observe, read, resolveAgent }
}

describe('cold continuable queue commands', () => {
  it('commits edit and remove, publishes the committed projection, and refreshes a retained cold read', async () => {
    const h = await harness()
    const abort = new AbortController()
    const stream = h.control.control(abort.signal)[Symbol.asyncIterator]()
    onTestFinished(async () => { abort.abort(); await stream.return?.() })
    await stream.next()
    using pinned = await h.observe()
    expect(pinned.projections?.values.inbox?.['next-turn'][0]).toMatchObject({ content: h.message.content })
    const revision = (await h.ctx.sessionPersistence.stat(h.id))!.revision
    expect((await h.read())['next-turn'][0]).toMatchObject({ content: h.message.content })
    await expect(h.controller.updateQueue({ sessionId: h.id, itemId: h.message.id,
      action: { kind: 'edit', content: [{ type: 'text', text: 'edited cold input' }] } })).resolves.toEqual({ accepted: true })
    expect((await stream.next()).value).toMatchObject({ type: 'projection', sessionId: h.id, key: 'inbox',
      value: { 'next-turn': [{ id: h.message.id, content: [{ type: 'text', text: 'edited cold input' }] }] } })
    expect((await h.ctx.sessionPersistence.stat(h.id))!.revision).not.toBe(revision)
    expect((await h.read())['next-turn'][0]).toMatchObject({ content: [{ type: 'text', text: 'edited cold input' }] })
    expect(pinned.projections?.values.inbox?.['next-turn'][0]).toMatchObject({ content: h.message.content })
    await expect(h.controller.updateQueue({ sessionId: h.id, itemId: h.message.id, action: { kind: 'remove' } }))
      .resolves.toEqual({ accepted: true })
    expect((await h.read())['next-turn']).toEqual([])
    await using stored = await h.ctx.sessionPersistence.open(h.id, 'read')
    const events = (await stored.read()).events
    expect(events.slice(-2).map(event => event.type)).toEqual(['agent/inbox/spliced', 'agent/inbox/spliced'])
    const reopened = new Context()
    const fiber = await reopened.plugin(JsonlSessionPersistence, { root: h.root, compression: 'none' })
    try {
      await using independent = await reopened.sessionPersistence.open(h.id, 'read')
      expect((await independent.read()).events).toEqual(events)
    } finally { await fiber.dispose() }
    expect(h.publish).toHaveBeenCalledTimes(2)
    expect(h.ctx.sessions.get(h.id)).toBeUndefined()
    expect(h.ctx.agents.get(h.id)).toBeUndefined()
    expect(h.resolveAgent).not.toHaveBeenCalled()
    await expect(h.controller.updateQueue({ sessionId: h.id, itemId: h.message.id, action: { kind: 'remove' } }))
      .rejects.toMatchObject({ code: 'session/queue-item-not-found' })
  })

  it('commits interrupted step and turn recovery before publishing above the observed cold sequence', async () => {
    const h = await harness('continuable', true)
    using observed = await h.observe()
    const floor = observed.projections!.asOfSeq
    expect(observed.events.slice(-2).map(event => event.type)).toEqual(['step/end', 'turn/end'])
    await h.controller.updateQueue({ sessionId: h.id, itemId: h.message.id,
      action: { kind: 'edit', content: [{ type: 'text', text: 'edited after crash' }] } })
    expect(h.publish.mock.calls[0]![2]).toBeGreaterThan(floor)
    await using stored = await h.ctx.sessionPersistence.open(h.id, 'read')
    expect((await stored.read()).events.slice(-3).map(event => event.type))
      .toEqual(['step/end', 'turn/end', 'agent/inbox/spliced'])
    expect((await h.read())['next-turn'][0]).toMatchObject({ content: [{ type: 'text', text: 'edited after crash' }] })
    expect(h.ctx.agents.get(h.id)).toBeUndefined()
    expect(h.ctx.sessions.get(h.id)).toBeUndefined()
  })

  it.each(['one-shot', 'seed-only', 'root'] as const)('rejects %s without appending or activating an Agent', async (mode) => {
    const h = await harness(mode)
    await expect(h.controller.updateQueue({ sessionId: h.id, itemId: h.message.id, action: { kind: 'remove' } }))
      .rejects.toMatchObject({ code: mode === 'root' ? 'session/queue-item-not-found' : 'session/agent-busy' })
    expect((await h.read())['next-turn'][0]).toMatchObject({ id: h.message.id })
    expect(h.publish).not.toHaveBeenCalled()
    expect(h.ctx.agents.get(h.id)).toBeUndefined()
    expect(h.resolveAgent).not.toHaveBeenCalled()
  })

  it('rejects stale occurrences and cold steering without changing the durable inbox', async () => {
    const h = await harness()
    await expect(h.controller.updateQueue({ sessionId: h.id, itemId: MessageId('stale'), action: { kind: 'remove' } }))
      .rejects.toMatchObject({ code: 'session/queue-item-not-found' })
    await expect(h.controller.updateQueue({ sessionId: h.id, itemId: h.message.id, action: { kind: 'steer' } }))
      .rejects.toMatchObject({ code: 'session/steer-unavailable' })
    expect((await h.read())['next-turn'][0]).toMatchObject({ id: h.message.id })
    expect(h.publish).not.toHaveBeenCalled()
  })

  it('respects an existing write owner and releases its own lease after a rejected mutation', async () => {
    const h = await harness()
    const writer = await h.ctx.sessionPersistence.open(h.id, 'write')
    try {
      await expect(h.controller.updateQueue({ sessionId: h.id, itemId: h.message.id, action: { kind: 'remove' } }))
        .rejects.toMatchObject({ code: 'session/writer-held' })
      expect((await h.read())['next-turn'][0]).toMatchObject({ id: h.message.id })
    } finally { await writer.close() }
    await expect(h.controller.updateQueue({ sessionId: h.id, itemId: h.message.id, action: { kind: 'remove' } }))
      .resolves.toEqual({ accepted: true })
    expect((await h.read())['next-turn']).toEqual([])
  })

  it('publishes nothing until the cold write flush has completed', async () => {
    const h = await harness()
    const original = h.ctx.sessionPersistence.open.bind(h.ctx.sessionPersistence)
    let enter!: () => void
    const entered = new Promise<void>((resolve) => { enter = resolve })
    let release!: () => void
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const open = vi.spyOn(h.ctx.sessionPersistence, 'open').mockImplementation(async (...args) => {
      const handle = await original(...args)
      if (args[1] === 'write') {
        const flush = handle.flush.bind(handle)
        vi.spyOn(handle, 'flush').mockImplementation(async () => { enter(); await barrier; await flush() })
      }
      return handle
    })
    onTestFinished(() => { release(); open.mockRestore() })
    const pending = h.controller.updateQueue({ sessionId: h.id, itemId: h.message.id, action: { kind: 'remove' } })
    await entered
    expect(h.publish).not.toHaveBeenCalled()
    release()
    await pending
    expect(h.publish).toHaveBeenCalledTimes(1)
    expect((await h.read())['next-turn']).toEqual([])
  })
})
