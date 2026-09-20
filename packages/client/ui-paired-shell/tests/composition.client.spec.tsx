// @vitest-environment jsdom
/** Real phone roster through Cordis Loader, with only the external Host replaced by fixture RPC. */
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { afterEach, expect, it, vi } from 'vitest'
import { act, fireEvent, waitFor, within } from '@testing-library/react'
import { createFixtureFaces } from '@deepseek-ai/dsh-client-connection/src/client/fixture.ts'
import type { ClientTransportHooks } from '@deepseek-ai/dsh-client-connection/client'
import * as modules from '@deepseek-ai/dsh-client-modules/client'
import type { ClientBundleRegistration, ClientModuleLoaderTarget, DshWindow } from '@deepseek-ai/dsh-client-modules/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import * as connection from '@deepseek-ai/dsh-client-connection/client'
import * as registry from '@deepseek-ai/dsh-typert-registry/client'
import * as gateway from '@deepseek-ai/dsh-api-gateway/client'
import * as remotes from '@deepseek-ai/dsh-api-remotes/client'
import * as sessions from '@deepseek-ai/dsh-api-session-controller/client'
import * as fileUpload from '@deepseek-ai/dsh-client-file-upload/client'
import * as settings from '@deepseek-ai/dsh-client-ui-settings/client'
import * as locale from '@deepseek-ai/dsh-client-locale/client'
import * as keyboard from '@deepseek-ai/dsh-client-keyboard/client'
import * as theme from '@deepseek-ai/dsh-client-ui-theme/client'
import * as renderer from '@deepseek-ai/dsh-client-ui-renderer/client'
import * as uiSession from '@deepseek-ai/dsh-client-ui-session/client'
import * as conversation from '@deepseek-ai/dsh-client-ui-conversation/client'
import * as chat from '@deepseek-ai/dsh-client-ui-chat/client'
import * as tool from '@deepseek-ai/dsh-client-ui-tool/client'
import * as approval from '@deepseek-ai/dsh-client-ui-approval/client'
import * as questions from '@deepseek-ai/dsh-client-ui-user-questions/client'
import * as shell from '../src/client/index.ts'

const roster = new Map<string, Record<string, unknown>>([
  ['@deepseek-ai/dsh-client-modules', modules],
  ['@deepseek-ai/dsh-client-connection', connection],
  ['@deepseek-ai/dsh-typert-registry', registry],
  ['@deepseek-ai/dsh-api-gateway', gateway],
  ['@deepseek-ai/dsh-api-remotes', remotes],
  ['@deepseek-ai/dsh-api-session-controller', sessions],
  ['@deepseek-ai/dsh-client-file-upload', fileUpload],
  ['@deepseek-ai/dsh-client-ui-settings', settings],
  ['@deepseek-ai/dsh-client-locale', locale],
  ['@deepseek-ai/dsh-client-keyboard', keyboard],
  ['@deepseek-ai/dsh-client-ui-theme', theme],
  ['@deepseek-ai/dsh-client-ui-renderer', renderer],
  ['@deepseek-ai/dsh-client-ui-session', uiSession],
  ['@deepseek-ai/dsh-client-ui-conversation', conversation],
  ['@deepseek-ai/dsh-client-ui-chat', chat],
  ['@deepseek-ai/dsh-client-ui-tool', tool],
  ['@deepseek-ai/dsh-client-ui-approval', approval],
  ['@deepseek-ai/dsh-client-ui-user-questions', questions],
  ['@deepseek-ai/dsh-client-ui-paired-shell', shell],
])
const win = globalThis as DshWindow & { __DSH_TRANSPORT__?: ClientTransportHooks }
let ctx: Context | undefined
let unmount: (() => void) | undefined
let fixtureDirectory: string | undefined

afterEach(async () => {
  await act(async () => { unmount?.(); await ctx?.fiber.dispose() })
  unmount = undefined
  ctx = undefined
  if (fixtureDirectory !== undefined) await rm(fixtureDirectory, { recursive: true, force: true })
  fixtureDirectory = undefined
  delete win.__ModuleLoader__
  delete win.__DSH_TRANSPORT__
  document.body.innerHTML = ''
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function boot() {
  vi.stubGlobal('location', new URL('https://127.0.0.1/paired/'))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
  const rpc = createFixtureFaces().rpc
  const calls: string[] = []
  win.__DSH_TRANSPORT__ = {
    ownsHost: false,
    authority: 'paired',
    pairingProtocolVersion: 1,
    fetch: async (_url, init) => {
      if (typeof init.body !== 'string') throw new Error('Fixture RPC expects a JSON body')
      const request = JSON.parse(init.body) as { method: string; payload: unknown; rpcId: string }
      calls.push(request.method)
      const result = await rpc.call('/api', request.method, request.payload, init.signal ?? undefined)
      return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    },
    openStream: (endpoint, payload, signal) => rpc.open!('/api', endpoint, payload, signal),
  }
  const pendingQueue: ClientBundleRegistration[] = [...roster].filter(([id]) => id !== '@deepseek-ai/dsh-client-modules').map(([id, value]) => ({ id, factory: () => value }))
  const target: ClientModuleLoaderTarget = {
    mode: 'queue', pendingQueue,
    load: (entry) => { pendingQueue.push(entry) },
    create: options => modules.createClientModuleSystem(target, {
      id: '@deepseek-ai/dsh-client-modules', exports: modules,
    }, options),
  }
  win.__ModuleLoader__ = target
  const moduleSystem = target.create({
    boot: { rev: 'phone-fixture', entries: [...roster.keys()].map(id => ({ id, rev: 'fixture', url: '/fixture.js' })),
      batches: [{ phase: 'application', rev: 'fixture', url: '/fixture.js', entries: [...roster.keys()] }] },
    staticModules: {},
    loadBundle: async () => { throw new Error('All fixture factories must be preloaded') },
  })
  ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = moduleSystem as never
  fixtureDirectory = await mkdtemp(join(tmpdir(), 'dsh-paired-shell-'))
  const fixturePath = join(fixtureDirectory, 'cordis.yml')
  await copyFile(resolve('packages/client/ui-paired-shell/tests/fixtures/cordis.yml'), fixturePath)
  await ctx.loader.create({ name: 'cordis:include', config: {
    path: pathToFileURL(fixturePath).href,
  } })
  await ctx.loader.await()
  expect([...ctx.loader.entries()].map(entry => [entry.options.name, entry.fiber?.state]))
    .toEqual(expect.arrayContaining([...roster.keys()].map(name => [name, FiberState.ACTIVE])))
  await waitFor(() => { expect(ctx!.sessions.list.getSnapshot().phase).toBe('ready') })
  const container = document.createElement('div')
  document.body.append(container)
  await act(async () => { unmount = ctx!.uiRenderer.mount(container) })
  return { ctx, container, calls, view: within(container) }
}

it('boots the restricted roster, selects an authorized conversation, and keeps settings local', async () => {
  const b = await boot()
  expect(b.ctx.remote.$host.isLoopback).toBe(false)
  expect(b.view.getByRole('combobox', { name: 'Authorized sessions' })).toBeTruthy()
  fireEvent.change(b.view.getByRole('combobox'), { target: { value: 'fx-gamma' } })
  await waitFor(() => { expect(b.container.querySelector('[data-composer-input]')?.getAttribute('contenteditable')).toBe('true') })
  const scoped = b.ctx.sessions.scope('fx-gamma' as SessionId)!
  const sessionConversation = scoped.get('conversation')!
  await act(async () => { await sessionConversation.send('Message from paired phone') })
  await waitFor(() => { expect(b.view.getByText('Message from paired phone')).toBeTruthy() })
  await act(async () => { await sessionConversation.cancel() })
  expect(b.calls).toContain('session/prompt')
  expect(b.calls).toContain('session/cancel')
  expect(b.calls.filter(method => method.startsWith('settings/'))).toEqual([])
  fireEvent.change(b.view.getByRole('combobox'), { target: { value: 'fx-alpha' } })
  fireEvent.click(await b.view.findByRole('button', { name: 'Dismiss all questions' }))
  fireEvent.click(await b.view.findByRole('button', { name: 'Allow once' }))
  await waitFor(() => { expect(b.calls.filter(method => method === '$events/result')).toHaveLength(2) })
  expect(b.ctx.get('layout')).toBeUndefined()
  expect(b.ctx.get('workspaces')).toBeUndefined()
  expect(b.ctx.slots.entries('settings.general.item')).toEqual([])
  const workspace = b.ctx.get('uiWorkspace')!
  const beforeRefusals = [...b.calls]
  await expect(workspace.pickDirectory()).rejects.toThrow('unavailable')
  await expect(workspace.listDirectory()).rejects.toThrow('unavailable')
  await expect(workspace.createDirectory('/fixture', 'child')).rejects.toThrow('unavailable')
  await expect(workspace.archiveSession('fx-gamma' as SessionId)).rejects.toThrow('unavailable')
  await expect(workspace.unarchiveSession('fx-gamma' as SessionId)).rejects.toThrow('unavailable')
  expect(() => { workspace.startSession() }).toThrow('unavailable')
  expect(b.calls).toEqual(beforeRefusals)
  const rootEntry = [...b.ctx.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-client-ui-paired-shell')!
  await act(async () => {
    unmount?.()
    unmount = undefined
    await rootEntry.fiber!.dispose()
  })
  expect(b.ctx.slots.entries('root')).toEqual([])
  expect(b.ctx.get('uiWorkspace')).toBeUndefined()
  expect(document.body.style.getPropertyValue('--dsh-content-font-size')).toBe('')
})
