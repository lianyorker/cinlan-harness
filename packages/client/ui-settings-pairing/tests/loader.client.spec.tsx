// @vitest-environment jsdom
/** Real Loader, Remote codecs, Session model, locale and renderer; external RPC is a fixture. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import * as connection from '@deepseek-ai/dsh-client-connection/client'
import * as registry from '@deepseek-ai/dsh-typert-registry/client'
import * as gateway from '@deepseek-ai/dsh-api-gateway/client'
import * as remotes from '@deepseek-ai/dsh-api-remotes/client'
import * as sessions from '@deepseek-ai/dsh-api-session-controller/client'
import * as fileUpload from '@deepseek-ai/dsh-client-file-upload/client'
import * as settings from '@deepseek-ai/dsh-client-ui-settings/client'
import * as locale from '@deepseek-ai/dsh-client-locale/client'
import * as renderer from '@deepseek-ai/dsh-client-ui-renderer/client'
import * as uiSession from '@deepseek-ai/dsh-client-ui-session/client'
import type { RemoteAccessStatus } from '@deepseek-ai/dsh-remote-access/types'
import * as pairing from '../src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'
import type { PairingInjected } from '../src/client/types.ts'
import { device, externalRpc } from './external-rpc.client.ts'

function button(element: HTMLElement): HTMLButtonElement {
  if (!(element instanceof HTMLButtonElement)) throw new Error('Expected a button element')
  return element
}

function checkbox(element: HTMLElement): HTMLInputElement {
  if (!(element instanceof HTMLInputElement)) throw new Error('Expected an input element')
  return element
}

const contexts: Context[] = []
const roots: string[] = []
const clientSessions = (value: Context): sessions.ISessions => value.sessions as unknown as sessions.ISessions
afterEach(async () => {
  cleanup()
  await act(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
const owner = { inject: ['slots'], apply(ctx: Context) {
  ctx.effect(() => ctx.slots.register({ name: 'root', children: {
    'settings.section': { kind: 'list', scope: 'root' }, 'settings.section.icon': { kind: 'keyed', scope: 'root' },
  } }, (props: PropsRenderSlots<'settings.section' | 'settings.section.icon'>) => <>{props.renderSlot('settings.section', { close() {} })}</>))
} }
async function boot(state: RemoteAccessStatus['state'] = 'disabled', paired = false) {
  vi.stubGlobal('location', new URL('https://127.0.0.1/'))
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
  const rpc = externalRpc(state, paired)
  vi.stubGlobal('__DSH_TRANSPORT__', rpc.transport)
  const roster = { connection, registry, gateway, remotes, sessions, fileUpload, settings, locale, renderer, uiSession, pairing, owner }
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  Object.assign(ctx.loader.builtins, roster)
  // Loader persists explicit entry disposal, so each case owns a writable copy.
  const root = await mkdtemp(join(tmpdir(), 'dsh-pairing-ui-'))
  roots.push(root)
  const config = join(root, 'cordis.yml')
  await writeFile(config, await readFile(resolve('packages/client/ui-settings-pairing/tests/fixtures/cordis.yml'), 'utf8'))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  const names = Object.keys(roster).map(name => 'cordis:' + name)
  expect([...ctx.loader.entries()].filter(row => names.includes(row.options.name)).map(row => [row.options.name, row.fiber?.state]))
    .toEqual(expect.arrayContaining(names.map(name => [name, FiberState.ACTIVE])))
  await waitFor(() => { expect(clientSessions(ctx).list.getSnapshot().phase).toBe('ready') })
  const view = render(<>{ctx.slots.renderSlot('root', {})}</>)
  return { ctx, view, rpc }
}

it('requires explicit Session and scope grants, displays and cancels an invitation, revokes a device', async () => {
  const b = await boot()
  await b.view.findByText(en.disabled)
  expect(button(b.view.getByRole('button', { name: en.create })).disabled).toBe(true)
  expect(b.rpc.calls.filter(call => call.method === 'pairing/createInvitation')).toEqual([])
  fireEvent.click(b.view.getByRole('button', { name: en.enable }))
  await b.view.findByText(en.ready)
  const sessionList = clientSessions(b.ctx).list.getSnapshot()
  const sessionLabel = sessionList.byId['fx-alpha' as keyof typeof sessionList.byId]!.displayTitle + ' fx-alpha'
  fireEvent.click(b.view.getByRole('checkbox', { name: sessionLabel }))
  expect(checkbox(b.view.getByRole('checkbox', { name: en['scope.session:read'] })).checked).toBe(true)
  for (const key of ['scope.session:send', 'scope.session:stop', 'scope.questions:answer', 'scope.approvals:decide'] as const) {
    expect(checkbox(b.view.getByRole('checkbox', { name: en[key] })).checked).toBe(false)
  }
  fireEvent.click(b.view.getByRole('checkbox', { name: en['scope.questions:answer'] }))
  fireEvent.click(b.view.getByRole('button', { name: en.create }))
  await b.view.findByText('482915')
  expect(b.rpc.calls.find(call => call.method === 'pairing/createInvitation')?.payload).toMatchObject({
    args: { request: { sessionIds: ['fx-alpha'], scopes: ['session:read', 'questions:answer'] } },
  })
  expect(b.view.getByText('https://desktop.example:7443/pair')).toBeTruthy()
  expect(b.view.getByText('invite-1')).toBeTruthy()
  const writeText = vi.fn(async (_value: string) => {})
  vi.stubGlobal('navigator', { clipboard: { writeText }, languages: navigator.languages })
  fireEvent.click(b.view.getByRole('button', { name: en.copy + ' ' + en.link }))
  await b.view.findByText(en.copied)
  expect(writeText).toHaveBeenCalledWith('https://desktop.example:7443/pair')
  fireEvent.click(b.view.getByRole('button', { name: en.cancel }))
  await waitFor(() => { expect(b.view.queryByText('482915')).toBeNull() })
  fireEvent.click(b.view.getByRole('button', { name: 'Revoke Test phone' }))
  await b.view.findByText(en.revoked)
  expect(b.rpc.calls.find(call => call.method === 'pairing/revokeDevice')?.payload).toMatchObject({ args: { request: { deviceId: device.deviceId } } })
  expect(b.view.getByText('session:read')).toBeTruthy()
  expect(b.rpc.calls.some(call => call.method === 'session/prompt')).toBe(false)
  expect(localStorage.getItem('phone-pairing')).toBeNull()
  fireEvent.click(b.view.getByRole('button', { name: en.disable }))
  await b.view.findByText(en.disabled)
})

it('shows actual missing configuration, keeps invitation disabled, and localizes metadata', async () => {
  const b = await boot('not-configured')
  await b.view.findByText(en.notConfigured)
  expect(b.view.container.textContent).toMatchSnapshot('not-configured English')
  for (const key of ['missing.advertisedOrigin', 'missing.tlsCertificatePath', 'missing.tlsPrivateKeyPath'] as const) expect(b.view.getByText(en[key])).toBeTruthy()
  expect(b.view.queryByText(en['missing.hostAdapter'])).toBeNull()
  expect(button(b.view.getByRole('button', { name: en.create })).disabled).toBe(true)
  const entry = b.ctx.slots.entries('settings.section')[0]!
  const injected = (entry.inject as unknown as () => PairingInjected)()
  expect(injected.hooks.pairingSessions).toBe(clientSessions(b.ctx).list)
  expect(b.ctx.settingsMetadata.getSnapshot().sections).toEqual([{ sectionId: 'phone-pairing', groupId: 'personal' }])
  expect(JSON.stringify(b.ctx.settingsMetadata.getSnapshot())).not.toContain('device-1')
  await act(async () => { b.ctx.locale.setLocale('zh') })
  expect(b.view.getByRole('heading', { name: zh.title })).toBeTruthy()
  expect(b.ctx.settingsMetadata.getSnapshot().items[0]?.title).toBe(zh.listener)
  expect(b.view.container.textContent).toMatchSnapshot('not-configured Chinese')
  b.view.unmount()
  const fixturePath = resolve('packages/client/ui-settings-pairing/tests/fixtures/cordis.yml')
  const fixtureBeforeDisposal = await readFile(fixturePath, 'utf8')
  const row = [...b.ctx.loader.entries()].find(value => value.options.id === 'pairing')!
  await row.fiber!.dispose()
  expect(await readFile(fixturePath, 'utf8')).toBe(fixtureBeforeDisposal)
  expect(b.ctx.slots.entries('settings.section')).toEqual([])
  expect(b.ctx.slots.entries('settings.section.icon')).toEqual([])
  expect(b.ctx.settingsMetadata.getSnapshot().sections).toEqual([])
})

it('does not register or invoke management on a paired carrier even when loaded', async () => {
  const b = await boot('ready', true)
  expect(b.ctx.remote.$host.isLoopback).toBe(false)
  expect(b.ctx.slots.entries('settings.section')).toEqual([])
  expect(b.rpc.calls.filter(call => call.method.startsWith('pairing/'))).toEqual([])
})

it('renders a localized failure without reporting success or leaking raw diagnostics', async () => {
  const b = await boot('ready')
  await b.view.findByText(en.ready)
  b.rpc.fail()
  fireEvent.click(b.view.getByRole('button', { name: en.refresh }))
  expect(await b.view.findByRole('alert')).toHaveProperty('textContent', en.failed)
  expect(within(b.view.container).queryByText('fixture failure')).toBeNull()
})
