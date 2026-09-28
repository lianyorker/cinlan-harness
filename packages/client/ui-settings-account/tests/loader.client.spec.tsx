// @vitest-environment jsdom
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { resolveSlotLabel, type PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { AccountAuthorizationMethodId, AccountAuthorizationSnapshot } from '@deepseek-ai/dsh-api-account-controller/types'
import type { AccountRemote } from '../src/client/source.ts'
import { TestRemote, TestSessions } from '@deepseek-ai/dsh-client-test-runtime'
import * as locale from '@deepseek-ai/dsh-client-locale/client'
import * as renderer from '@deepseek-ai/dsh-client-ui-renderer/client'
import * as settings from '@deepseek-ai/dsh-client-ui-settings/client'
import * as uiSession from '@deepseek-ai/dsh-client-ui-session/client'
import * as account from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'

const KEY = credentialKey('llm-pi-ai', 'sub2api')
const METHOD = 'password' as AccountAuthorizationMethodId
const snapshot: AccountAuthorizationSnapshot = {
  flows: [{
    key: KEY, label: 'Cinlan account', methods: [{ id: METHOD, label: 'Sign in to Cinlan' }],
    inFlight: false, credential: { configured: false, writable: true },
  }],
}
const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  cleanup()
  await act(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

const remotePlugin = {
  apply(ctx: Context) {
    let watchCalls = 0
    let closeAuthorization: (() => void) | undefined
    const accountFace = {
      async *watch(signal: AbortSignal) {
        yield { ...snapshot, flows: [{ ...snapshot.flows[0]!, credential: { configured: true, kind: 'api-key', writable: true } }] }
        if (watchCalls++ === 0) throw Object.assign(new Error('temporary account outage'), { code: 'account/network' })
        await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      },
      async *authorize(_key: unknown, _method: unknown, signal: AbortSignal) {
        yield { type: 'started' as const, attemptId: '11111111-1111-4111-8111-111111111111', key: KEY, method: METHOD }
        yield { type: 'prompt' as const, attemptId: '11111111-1111-4111-8111-111111111111', prompt: { id: '22222222-2222-4222-8222-222222222222', kind: 'secret' as const, message: 'Account password' } }
        await new Promise<void>((resolve) => {
          closeAuthorization = resolve
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
      },
      answer: async () => ({ ok: true as const, value: undefined }),
      cancel: async () => { closeAuthorization?.(); return { ok: true as const, value: true } },
      deleteCredential: async () => ({
        ok: true as const, value: { localDeleted: true, issuerRevoked: false as const },
      }),
    } as unknown as AccountRemote
    new TestRemote(ctx, {
      account: accountFace,
      settings: {
        describe: async () => ({ ok: true as const, value: { writable: true, hasDocument: false, namespaces: [] } }),
        update: async () => ({ ok: false as const, error: { code: 'settings/rejected', message: '', details: {} } }),
        replace: async () => ({ ok: false as const, error: { code: 'settings/rejected', message: '', details: {} } }),
        mutate: async () => ({ ok: false as const, error: { code: 'settings/rejected', message: '', details: {} } }),
      },
    })
  },
}
const connectionPlugin = {
  apply(ctx: Context) {
    ctx.provide('connection', { generation: createSnapshotStore({ id: 1 }) } as never)
  },
}
const sessionsPlugin = {
  apply(ctx: Context) {
    const sessions = new TestSessions(async (operation) => { await operation() }, ctx)
    ctx.provide('sessions', sessions)
  },
}
const owner = {
  inject: ['slots'],
  apply(ctx: Context) {
    ctx.effect(() => ctx.slots.register({ name: 'root', children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'settings.section.icon': { kind: 'keyed', scope: 'root' },
    } }, (props: PropsRenderSlots<'settings.section' | 'settings.section.icon'>) =>
      <>{props.renderSlot('settings.section', { close() {} })}</>))
  },
}

it('boots the Account Settings contribution through Loader and removes it with its fiber', async () => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
  const roster = { remotePlugin, connectionPlugin, sessionsPlugin, locale, renderer, settings, uiSession, account, owner }
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  Object.assign(ctx.loader.builtins, roster)
  const root = await mkdtemp(join(tmpdir(), 'dsh-account-ui-'))
  roots.push(root)
  const config = join(root, 'cordis.yml')
  await writeFile(config, [
    '- id: remote',
    '  name: cordis:remotePlugin',
    '- id: connection',
    '  name: cordis:connectionPlugin',
    '- id: sessions',
    '  name: cordis:sessionsPlugin',
    '- id: locale',
    '  name: cordis:locale',
    '- id: renderer',
    '  name: cordis:renderer',
    '- id: settings',
    '  name: cordis:settings',
    '- id: ui-session',
    '  name: cordis:uiSession',
    '- id: account',
    '  name: cordis:account',
    '- id: owner',
    '  name: cordis:owner',
    '',
  ].join('\n'))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()

  const names = Object.keys(roster).map(name => 'cordis:' + name)
  expect([...ctx.loader.entries()].filter(row => names.includes(row.options.name)).map(row => row.fiber?.state))
    .toEqual(names.map(() => FiberState.ACTIVE))
  const view = render(<>{ctx.slots.renderSlot('root', {})}</>)
  await view.findByRole('heading', { name: en.title })
  expect(view.getByText(en.cinlanAccount)).toBeTruthy()
  expect(ctx.settingsMetadata.getSnapshot().sections).toContainEqual({ sectionId: 'account', groupId: 'personal' })
  await waitFor(() => { expect(view.getByRole('alert').textContent).toContain(en.unavailable) })
  expect(resolveSlotLabel(ctx.slots.entriesOfSlot('settings.section').find(entry => entry.options.id === 'account')?.options.label))
    .toBe(en.title)
  const items = ctx.settingsMetadata.getSnapshot().items
  expect(items.map(item => item.title)).toEqual([en.account, en.authorization])
  expect(items[0]?.description).toBe(en.description)
  expect(items[0]?.keywords).toEqual([en.searchTerms])
  fireEvent.click(view.getByRole('button', { name: en.retry }))
  await waitFor(() => { expect(view.getByRole('button', { name: en.signInAgain })).toBeTruthy() })
  fireEvent.click(view.getByRole('button', { name: en.signInAgain }))
  const prompt = await view.findByLabelText('Account password')
  fireEvent.change(prompt, { target: { value: 'loader-secret' } })
  fireEvent.click(view.getByRole('button', { name: en.submit }))
  await waitFor(() => { expect(view.queryByLabelText('Account password')).toBeNull() })
  fireEvent.click(view.getByRole('button', { name: en.cancel }))
  await waitFor(() => { expect(view.getByText(en.failed)).toBeTruthy() })
  fireEvent.click(view.getByRole('button', { name: en.dismiss }))
  fireEvent.click(view.getByRole('button', { name: en.signOut }))
  fireEvent.click(within(view.getByRole('group', { name: en.confirmTitle })).getByRole('button', { name: en.remove }))
  await waitFor(() => { expect(view.getByText(en.deletedLocal)).toBeTruthy() })
  fireEvent.click(view.getByRole('button', { name: en.dismiss }))

  const row = [...ctx.loader.entries()].find(value => value.options.id === 'account')
  if (row?.fiber === undefined) throw new Error('Account Settings fixture has no active fiber')
  await act(async () => { await row.fiber!.dispose() })
  await waitFor(() => { expect(view.queryByRole('heading', { name: en.title })).toBeNull() })
  expect(ctx.settingsMetadata.getSnapshot().sections).not.toContainEqual({ sectionId: 'account', groupId: 'personal' })
})
