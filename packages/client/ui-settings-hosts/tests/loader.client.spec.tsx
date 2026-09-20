// @vitest-environment jsdom
/** Real Loader, Remote codecs, Session model, locale and renderer; external RPC is a fixture. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
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
import * as hosts from '../src/client/index.ts'
import { en } from '../src/client/locales.ts'
import { externalRpc } from './external-rpc.client.ts'
import { runtimeTask, target } from './fixtures.client.ts'

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
const owner = { inject: ['slots'], apply(ctx: Context) {
  ctx.effect(() => ctx.slots.register({ name: 'root', children: {
    'settings.section': { kind: 'list', scope: 'root' }, 'settings.section.icon': { kind: 'keyed', scope: 'root' },
  } }, (props: PropsRenderSlots<'settings.section' | 'settings.section.icon'>) => <>{props.renderSlot('settings.section', { close() {} })}</>))
} }
async function boot() {
  vi.stubGlobal('location', new URL('https://127.0.0.1/'))
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
  const rpc = externalRpc()
  vi.stubGlobal('__DSH_TRANSPORT__', rpc.transport)
  const roster = { connection, registry, gateway, remotes, sessions, fileUpload, settings, locale, renderer, uiSession, hosts, owner }
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  Object.assign(ctx.loader.builtins, roster)
  // Loader persists explicit entry disposal, so each case owns a writable copy.
  const root = await mkdtemp(join(tmpdir(), 'dsh-hosts-ui-'))
  roots.push(root)
  const config = join(root, 'cordis.yml')
  await writeFile(config, await readFile(resolve('packages/client/ui-settings-hosts/tests/fixtures/cordis.yml'), 'utf8'))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  const names = Object.keys(roster).map(name => 'cordis:' + name)
  expect([...ctx.loader.entries()].filter(row => names.includes(row.options.name)).map(row => [row.options.name, row.fiber?.state]))
    .toEqual(expect.arrayContaining(names.map(name => [name, FiberState.ACTIVE])))
  const view = render(<>{ctx.slots.renderSlot('root', {})}</>)
  return { ctx, view, rpc }
}

it('starts an exact-revision Host task, recovers it after leaving the page, and cancels only its receipt', async () => {
  const b = await boot()
  await b.view.findByRole('heading', { name: target.label })
  fireEvent.change(b.view.getByRole('combobox', { name: en['runtime.target'] }), { target: { value: target.id } })
  for (const [key, value] of Object.entries({ host: 'remote.example', username: 'operator', privateKeyFile: 'C:/keys/remote', hostKeySHA256: 'a'.repeat(64), node: '/usr/bin/node', installRoot: '/opt/runtime', workspace: '/srv/work' })) {
    fireEvent.change(b.view.getByRole('textbox', { name: en[('runtime.' + key) as keyof typeof en] }), { target: { value } })
  }
  fireEvent.click(b.view.getByRole('button', { name: en['runtime.install'] }))
  await b.view.findByText(runtimeTask.id)
  expect(b.rpc.calls.find(call => call.method === 'executionHosts/startRuntime')?.payload).toMatchObject({ args: { request: {
    target: { id: target.id, revision: target.revision }, operation: 'install', endpoint: { privateKeyFile: 'C:/keys/remote' },
  } } })
  b.view.unmount()
  expect(b.rpc.calls.some(call => call.method === 'executionHosts/cancelRuntimeTask')).toBe(false)
  const view = render(<>{b.ctx.slots.renderSlot('root', {})}</>)
  await view.findByText(runtimeTask.id)
  fireEvent.click(view.getByRole('button', { name: en['runtime.cancel'] }))
  await view.findByText(en['runtime.revision'].replace('{revision}', String(target.revision)) + ' · ' + en['runtime.cancelled'])
  expect(b.rpc.calls.find(call => call.method === 'executionHosts/cancelRuntimeTask')?.payload).toMatchObject({ args: { request: { id: runtimeTask.id } } })
  expect(view.container.textContent).not.toContain('C:/keys/remote')
  expect(view.container.textContent).toMatchSnapshot('runtime task receipt')
})
