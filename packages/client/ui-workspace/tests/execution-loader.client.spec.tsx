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
import * as workspace from '../src/client/index.ts'
import type { WorkspacePickerInjected } from '../src/client/contract/slots.ts'
import * as workspaces from '@deepseek-ai/dsh-api-workspace-controller/client'
import { useRef } from 'react'
import { en } from '../src/client/locales.ts'
import { externalRpc } from './external-rpc.client.ts'
import { target } from './external-rpc.client.ts'

function button(element: HTMLElement): HTMLButtonElement {
  if (!(element instanceof HTMLButtonElement)) throw new Error('Expected a button element')
  return element
}

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  cleanup()
  await act(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function Root(props: PropsRenderSlots<'conversation.hero.workspace'>) {
  const anchorRef = useRef<HTMLButtonElement>(null)
  return <><button ref={anchorRef}>Picker anchor</button>{props.renderSlot('conversation.hero.workspace', {
    open: true, anchorRef, onPick() {}, onClose() {},
  })}</>
}
const owner = { inject: ['slots'], apply(ctx: Context) {
  ctx.effect(() => ctx.slots.register({ name: 'root', children: {
    'conversation.hero.workspace': { kind: 'single', scope: 'root' },
  } }, Root))
} }
async function boot() {
  vi.stubGlobal('location', new URL('https://127.0.0.1/'))
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
  const rpc = externalRpc()
  vi.stubGlobal('__DSH_TRANSPORT__', rpc.transport)
  const roster = { connection, registry, gateway, remotes, sessions, fileUpload, settings, locale, renderer,
    uiSession, workspace, workspaces, owner }
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  Object.assign(ctx.loader.builtins, roster)
  // Loader persists explicit entry disposal, so each case owns a writable copy.
  const root = await mkdtemp(join(tmpdir(), 'dsh-workspace-ui-'))
  roots.push(root)
  const config = join(root, 'cordis.yml')
  await writeFile(config, await readFile(resolve('packages/client/ui-workspace/tests/fixtures/cordis.yml'), 'utf8'))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  const names = Object.keys(roster).map(name => 'cordis:' + name)
  expect([...ctx.loader.entries()].filter(row => names.includes(row.options.name)).map(row => [row.options.name, row.fiber?.state]))
    .toEqual(expect.arrayContaining(names.map(name => [name, FiberState.ACTIVE])))
  const view = render(<>{ctx.slots.renderSlot('root', {})}</>)
  return { ctx, view, rpc }
}

it('submits only target identity, revision and remote path through generated Remote', async () => {
  const b = await boot()
  fireEvent.click(await b.view.findByRole('menuitem', { name: en['menu.addWorkspace'] }))
  const dialog = await b.view.findByRole('dialog')
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: target.id + ':' + String(target.revision) } })
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '/srv/selected' } })
  fireEvent.click(within(dialog).getByRole('button', { name: en['execution.continue'] }))
  await waitFor(() => { expect(b.rpc.calls.some(call => call.method === 'workspace/create')).toBe(true) })
  expect(b.rpc.calls.find(call => call.method === 'workspace/create')?.payload).toEqual({ args: { request: {
    path: '/srv/selected', targetRevision: { id: target.id, revision: target.revision },
  } } })
  expect(JSON.stringify(b.rpc.calls.filter(call => call.method === 'workspace/create'))).not.toContain('privateKey')
  await waitFor(() => { expect(b.view.queryByRole('dialog')).toBeNull() })
})

it('withdraws a selected revision after an authoritative target change without local fallback', async () => {
  const b = await boot()
  fireEvent.click(await b.view.findByRole('menuitem', { name: en['menu.addWorkspace'] }))
  const dialog = await b.view.findByRole('dialog')
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: target.id + ':' + String(target.revision) } })
  await act(async () => { b.rpc.targets.push({ ...b.rpc.baseline, targets: [{ ...target, revision: target.revision + 1 }] }) })
  await b.view.findByText(en['execution.changed'])
  expect(button(within(dialog).getByRole('button', { name: en['execution.continue'] })).disabled).toBe(true)
  expect(b.rpc.calls.some(call => call.method === 'workspace/create')).toBe(false)
  expect(b.rpc.calls.some(call => call.method === 'directoryPicker/pick')).toBe(false)
  expect(dialog.textContent).toMatchSnapshot('stale remote Workspace selection')
})

it('clears optional target observations when the generated provider is removed and restores them on reload', async () => {
  const b = await boot()
  await b.view.findByRole('menuitem', { name: en['menu.addWorkspace'] })
  const entry = b.ctx.slots.entries('conversation.hero.workspace')[0]
  if (entry === undefined) throw new Error('Workspace picker did not register')
  const injected = (entry.inject as () => WorkspacePickerInjected)()
  expect(injected.hooks.executionTargets.getSnapshot().targets).toHaveLength(1)
  const provider = [...b.ctx.loader.entries()].find(row => row.options.name === 'cordis:remotes')
  if (provider === undefined) throw new Error('Generated Remote provider missing')
  b.view.unmount()
  await act(async () => { await provider.update({ disabled: true }); await b.ctx.loader.await() })
  expect(injected.hooks.executionTargets.getSnapshot()).toEqual({ available: false, targets: [] })
  await act(async () => { await provider.update({ disabled: false }); await b.ctx.loader.await() })
  const view = render(<>{b.ctx.slots.renderSlot('root', {})}</>)
  await view.findByRole('menuitem', { name: en['menu.addWorkspace'] })
})
