/** Desktop boot and live changes over a real Loader in an isolated project. */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '../../../packages/client/connection/src/rpc-host.ts'
import type { BrowserAuth } from '../../../packages/client/connection/src/browser-auth.ts'
import Hmr from '@deepseek-ai/cordis-plugin-hmr'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import * as appBoot from '@deepseek-ai/dsh-app-boot'
import * as proxy from '@deepseek-ai/dsh-http-proxy'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import PluginManager from '@deepseek-ai/dsh-plugin-manager'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { workspaceDependencyPaths, type PrimaryRuntimeManifest } from '../src/primary-runtime.ts'
import { desktopPatches, runDesktopHost } from '../src/index.ts'
import { DesktopHostResponseDecoder } from '../../desktop/src/host-protocol.ts'

async function fixture(options: {
  failBoot?: boolean
  connection?: (ctx: Context) => void
  openStream?: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<AsyncIterable<unknown>>
} = {}) {
  const home = mkdtempSync(join(tmpdir(), 'desktop-host-runtime-'))
  const project = join(home, 'profiles', 'desktop')
  const primaryRuntime = join(home, 'resources', 'runtime', 'primary-runtime')
  cpSync(new URL('../../../packages/skill/skill-office/assets/', import.meta.url), join(primaryRuntime, '..', 'office-skills'), { recursive: true })
  mkdirSync(project, { recursive: true })
  vi.stubEnv('DSH_HOME', home)
  const order: string[] = []
  const environment = createLaunchEnvironmentSnapshot([{ source: 'user-env', values: { HTTPS_PROXY: 'http://proxy.invalid:8080' } }])
  vi.spyOn(appBoot, 'loadLayeredEnv').mockImplementation(() => { order.push('environment'); return environment })
  const disposeProxy = vi.fn(async () => { order.push('proxy-disposed') })
  vi.spyOn(proxy, 'installProxyFromEnvironment').mockImplementation(async (snapshot) => {
    expect(snapshot).toBe(environment)
    order.push('proxy-installed')
    return disposeProxy
  })
  const packageFile = (name: string, filename: string, content: string) => {
    const file = join(project, 'node_modules', name, filename)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, content)
  }
  packageFile('@deepseek-ai/dsh', 'package.json', JSON.stringify({ name: '@deepseek-ai/dsh', version: '1.0.0', dependencies: {} }))
  packageFile('@deepseek-ai/dsh-web-frontend', 'package.json', JSON.stringify({ name: '@deepseek-ai/dsh-web-frontend', exports: { './dist/index.html': './dist/index.html' } }))
  packageFile('@deepseek-ai/dsh-web-frontend', 'dist/index.html', '<html><head></head><body>Desktop fixture</body></html>')
  for (const name of ['@deepseek-ai/dsh-host-directory-picker-native', '@deepseek-ai/dsh-client-ui-directory-picker-native']) {
    packageFile(name, 'package.json', JSON.stringify({ name, type: 'module', main: 'index.mjs' }))
    packageFile(name, 'index.mjs', 'export function apply() {}')
  }
  packageFile('test-bundle', 'package.json', JSON.stringify({ name: 'test-bundle', dsh: { bundle: { patch: 'cordis.patch.yml' } } }))
  packageFile('test-bundle', 'cordis.patch.yml', JSON.stringify([{ insert: [
    { id: 'system-prompt', name: 'cordis:systemPrompt' },
    { id: 'skills', name: 'cordis:skills' },
    { id: 'tools', name: 'cordis:tools' },
    { id: 'timer', name: 'cordis:timer' },
    { id: 'hmr', name: 'cordis:hmr', disabled: true },
    { id: 'plugin-manager', name: 'cordis:manager', disabled: true },
    { id: 'ui-plugin-manager', name: 'cordis:noop', disabled: true },
    { id: 'connection', name: 'cordis:connection' },
    { id: 'client-modules', name: 'cordis:modules' },
    { id: 'gateway', name: 'cordis:gateway' },
    { id: 'webserver', name: 'cordis:forbidden' },
    { id: 'web-startup', name: 'cordis:forbidden' },
    { id: 'web-runtime', name: 'cordis:forbidden' },
    { id: 'client-hmr', name: 'cordis:forbidden' },
    { id: 'directory-picker', name: 'cordis:forbidden' },
    { id: 'open-in-app', name: 'cordis:noop' },
    { id: 'ui-open-in-app', name: 'cordis:noop' },
    { id: 'probe', name: 'cordis:probe', config: { value: 1 } },
  ] }]))
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'desktop-fixture', private: true, dsh: { profile: { bundles: ['test-bundle'] } } }))
  writeFileSync(join(project, 'cordis.patch.yml'), '[]\n')
  let context: Context | undefined
  const realBoot = appBoot.boot
  vi.spyOn(appBoot, 'boot').mockImplementation((name, config, patches, prepare) => realBoot(name, config, patches, async (ctx) => {
    context = ctx
    await prepare?.(ctx)
    ctx.provide('credentials', {})
    ctx.provide('agents', { list: () => [] } as never)
    ctx.provide('jobs', { list: () => [] } as never)
    order.push('boot')
    ctx.effect(() => async () => {
      order.push('context-disposed')
    })
    ctx.loader.builtins.systemPrompt = SystemPrompt
    ctx.loader.builtins.skills = SkillRegistry
    ctx.loader.builtins.tools = ToolRuntime
    ctx.loader.builtins.timer = Timer
    ctx.loader.builtins.hmr = Hmr
    ctx.loader.builtins.manager = PluginManager
    ctx.loader.builtins.noop = { apply() {} }
    ctx.loader.builtins.forbidden = { apply() { throw new Error('Desktop must not mount Web carrier') } }
    ctx.loader.builtins.probe = { apply(scoped: Context, config: { value: number }) {
      if (options.failBoot) throw new Error('fixture boot failed')
      scoped.provide('desktopProbe', config.value)
    } }
    ctx.loader.builtins.connection = { apply(scoped: Context) {
      if (options.connection !== undefined) { options.connection(scoped); return }
      scoped.provide('connection', {
        createSharedFetchHandler: () => ({ fetch: () => {
          const value: unknown = ctx.get('desktopProbe')
          return Promise.resolve(Response.json({ value }))
        } }),
      })
    } }
    ctx.loader.builtins.modules = { apply(scoped: Context) { scoped.provide('clientModules', { fetchBundle: () => new Response('bundle') }) } }
    ctx.loader.builtins.gateway = { apply(scoped: Context) {
      scoped.provide('typertGateway', { wireStream: { open: options.openStream } })
    } }
  }))
  onTestFinished(async () => {
    try { await context?.fiber.dispose() } finally {
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
      rmSync(home, { recursive: true, force: true })
    }
  })
  return { home, project, primaryRuntime, order, disposeProxy, context: () => context! }
}

it('applies Desktop row toggles without changing its transport or shared resolver', async () => {
  const f = await fixture()
  const frames: Buffer[] = []
  const host = await runDesktopHost(f.project, async (frame) => { frames.push(frame) }, { primaryRuntime: f.primaryRuntime })
  onTestFinished(() => host.dispose())
  const ctx = f.context()
  const manager = ctx.get('pluginManager')!
  const managerUid = [...ctx.loader.entries()].find(row => row.options.id === 'plugin-manager')?.fiber?.uid
  const rows = await manager.listPlugins()
  const probe = rows.find(row => row.patchId === 'probe')!
  expect(await manager.setPluginEnabled(probe.entryId, false)).toMatchObject({ application: 'applied', changed: true })
  expect(ctx.get('desktopProbe')).toBeUndefined()
  expect(await manager.setPluginEnabled(probe.entryId, true)).toMatchObject({ application: 'applied', changed: true })
  expect(ctx.get('desktopProbe')).toBe(1)
  expect([...ctx.loader.entries()].find(row => row.options.id === 'plugin-manager')?.fiber?.uid).toBe(managerUid)
  expect([...ctx.loader.entries()].find(row => row.options.id === 'webserver')?.disabled).toBe(true)
  expect(ctx.hmr.config.root).toEqual([])
  expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['office-docx', 'office-pptx', 'office-xlsx'])
  expect(ctx.tools.schemas().map(tool => tool.name)).toContain('load_workspace_dependencies')
  expect((await ctx.skills.get('office-docx'))?.resourceBase).toEqual({
    kind: 'directory', path: join(f.primaryRuntime, '..', 'office-skills', 'office-docx'),
  })
  const missing = await ctx.tools.execute({ callId: ToolCallId('missing-bundled-runtime'), name: 'load_workspace_dependencies',
    arguments: {}, signal: new AbortController().signal })
  expect(missing.isError).toBe(true)
  expect(missing.content).toEqual([{ type: 'text', text: expect.stringContaining('bundled payload metadata is missing') as unknown }])
  expect(existsSync(join(f.home, 'profiles', 'node_modules'))).toBe(false)
  const connection = (await manager.listPlugins()).find(row => row.entryId === 'include:connection')!
  expect(await manager.setPluginEnabled(connection.entryId, false)).toMatchObject({ changed: false, application: 'failed' })
  await host.fetch({ streamId: 1, request: { url: 'dsh-app://app/api/probe', method: 'GET', headers: [] } }, null)
  const decoded = new DesktopHostResponseDecoder().push(Buffer.concat(frames))
  expect(decoded[0]).toMatchObject({ type: 'start', status: 200 })
  expect(decoded.filter(row => row.type === 'data').map(row => row.data.toString()).join('')).toBe('{"value":1}')
  await host.dispose()
  expect(f.order).toEqual(['environment', 'proxy-installed', 'boot', 'context-disposed', 'proxy-disposed'])
  expect(f.disposeProxy).toHaveBeenCalledTimes(1)
  expect(readFileSync(join(f.project, 'cordis.patch.yml'), 'utf8')).toContain('disabled: false')
})

it.skipIf(process.platform === 'linux')('installs bundled dependencies through the booted Host and retains Office after a profile reload', async () => {
  const f = await fixture()
  const manifest: PrimaryRuntimeManifest = {
    desktopVersion: '1.0.0', platform: process.platform, arch: process.arch,
    components: { python: '3.12.14', node: '24.21.0', pnpm: '11.7.0', numpy: '2.3.5', pandas: '3.0.1' },
    pythonPackages: { 'python-docx': '1.2.0' },
  }
  const sourcePaths = workspaceDependencyPaths(f.primaryRuntime, manifest)
  for (const path of [sourcePaths.python, sourcePaths.node, sourcePaths.pnpm]) {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, 'fixture bytes')
  }
  for (const path of [sourcePaths.pythonPackages, sourcePaths.nodePackages]) mkdirSync(path, { recursive: true })
  writeFileSync(join(f.primaryRuntime, 'runtime.json'), JSON.stringify(manifest))
  const host = await runDesktopHost(f.project, async () => {}, { primaryRuntime: f.primaryRuntime })
  onTestFinished(() => host.dispose())
  const ctx = f.context()
  const result = await ctx.tools.execute({ callId: ToolCallId('bundled-runtime'), name: 'load_workspace_dependencies',
    arguments: {}, signal: new AbortController().signal })
  const installed = workspaceDependencyPaths(join(f.home, 'dsh-runtimes', 'dsh-primary-runtime'), manifest)
  expect(result).toMatchObject({ isError: false, content: [{ type: 'text', text: JSON.stringify(installed, undefined, 2) }] })
  expect(readFileSync(installed.python, 'utf8')).toBe('fixture bytes')
  writeFileSync(join(f.project, 'cordis.patch.yml'), '- id: probe\n  config:\n    value: 99\n')
  await vi.waitFor(() => { expect(ctx.get('desktopProbe')).toBe(99) }, { timeout: 3_000 })
  expect((await ctx.skills.list()).map(skill => skill.name)).toEqual(['office-docx', 'office-pptx', 'office-xlsx'])
  expect(ctx.tools.schemas().filter(tool => tool.name === 'load_workspace_dependencies')).toHaveLength(1)
})

it('reapplies saved configuration with mandatory transport and manager overlays', async () => {
  const f = await fixture()
  const host = await runDesktopHost(f.project, async () => {}, { primaryRuntime: f.primaryRuntime })
  onTestFinished(() => host.dispose())
  const ctx = f.context()
  const managerUid = [...ctx.loader.entries()].find(row => row.options.id === 'plugin-manager')?.fiber?.uid
  writeFileSync(join(f.project, 'cordis.patch.yml'), '- id: probe\n  config:\n    value: 42\n- id: webserver\n  disabled: false\n- id: plugin-manager\n  disabled: true\n')
  await vi.waitFor(() => { expect(ctx.get('desktopProbe')).toBe(42) }, { timeout: 3_000 })
  expect([...ctx.loader.entries()].find(row => row.options.id === 'plugin-manager')?.fiber?.uid).toBe(managerUid)
  expect([...ctx.loader.entries()].find(row => row.options.id === 'webserver')?.disabled).toBe(true)
})

it('keeps native transport overlays in every generation', async () => {
  const f = await fixture()
  writeFileSync(join(f.project, 'cordis.patch.yml'), '- id: webserver\n  disabled: false\n- id: hmr\n  config:\n    root: [src]\n')
  const rows = appBoot.composeEntries([desktopPatches(f.project, false)])
  expect(rows.find(row => row.id === 'webserver')?.disabled).toBe(true)
  expect(rows.find(row => row.id === 'hmr')?.config).toEqual({ root: [] })
})

it('fails Host readiness and disposes its context when Office resources are missing', async () => {
  const f = await fixture()
  rmSync(join(f.primaryRuntime, '..', 'office-skills'), { recursive: true })
  await expect(runDesktopHost(f.project, async () => {}, { primaryRuntime: f.primaryRuntime })).rejects.toThrow()
  expect(f.order).toEqual(['environment', 'proxy-installed', 'boot', 'context-disposed', 'proxy-disposed'])
})

it('disposes the proxy after a failed boot has torn down the context', async () => {
  const f = await fixture({ failBoot: true })
  await expect(runDesktopHost(f.project, async () => {}, { primaryRuntime: f.primaryRuntime })).rejects.toThrow('fixture boot failed')
  expect(f.order).toEqual(['environment', 'proxy-installed', 'boot', 'context-disposed', 'proxy-disposed'])
  expect(f.disposeProxy).toHaveBeenCalledTimes(1)
})

it('tears down the booted context and proxy when watcher registration fails', async () => {
  const f = await fixture()
  vi.spyOn(Hmr.prototype, 'registerConfig').mockRejectedValueOnce(new Error('fixture watcher failed'))
  await expect(runDesktopHost(f.project, async () => {}, { primaryRuntime: f.primaryRuntime })).rejects.toThrow('fixture watcher failed')
  expect(f.order).toEqual(['environment', 'proxy-installed', 'boot', 'context-disposed', 'proxy-disposed'])
  expect(f.disposeProxy).toHaveBeenCalledTimes(1)
})

it('disposes the proxy when composition fails before a context exists', async () => {
  const f = await fixture()
  writeFileSync(join(f.project, 'package.json'), '{invalid')
  await expect(runDesktopHost(f.project, async () => {}, { primaryRuntime: f.primaryRuntime })).rejects.toThrow()
  expect(f.order).toEqual(['environment', 'proxy-installed', 'proxy-disposed'])
})

it('drains real RPC dispatch and excludes an open SSE response from the drain', async () => {
  const entered = Promise.withResolvers<undefined>()
  const mutation = Promise.withResolvers<undefined>()
  const body = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>()
  let active = false
  const f = await fixture({ connection(ctx) {
    new HostConnectionService(ctx, [], {} as BrowserAuth)
    ctx.connection.rpc.intercept('/api', () => true, async () => {
      entered.resolve(undefined)
      await mutation.promise
      active = true
      return { ok: true, value: 'started' }
    })
    ctx.connection.fetch.register({ path: '/api/events', methods: ['GET'], requestBody: 'buffered', fetch: async () =>
      new Response(new ReadableStream<Uint8Array>({ start(controller) { body.resolve(controller) } }),
        { headers: { 'content-type': 'text/event-stream' } }),
    })
  } })
  const frames: Buffer[] = []
  const host = await runDesktopHost(f.project, async (frame) => { frames.push(frame) }, { primaryRuntime: f.primaryRuntime })
  onTestFinished(() => host.dispose())
  vi.spyOn(f.context().get('jobs')!, 'list').mockImplementation(() => active ? [{ status: 'running' } as never] : [])
  const sse = host.fetch({ streamId: 1, request: { url: 'dsh-app://app/api/events', method: 'GET', headers: [] } }, null)
  const bodyController = await body.promise
  onTestFinished(() => { bodyController.close(); return sse })
  const request = new Request('http://app/api/start', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'start-1', method: 'start', payload: {} }) })
  const rpc = host.fetch({ streamId: 2, request: { url: 'dsh-app://app/api/start', method: 'POST', headers: [...request.headers] } }, request.body)
  await entered.promise
  let finished = false
  const lock = host.updateTasks('lock').then((result) => { finished = true; return result })
  await host.fetch({ streamId: 3, request: { url: 'dsh-app://app/api/late', method: 'GET', headers: [] } }, null)
  expect(finished).toBe(false)
  mutation.resolve(undefined)
  await rpc
  await expect(lock).resolves.toBe(true)
  const decoded = new DesktopHostResponseDecoder().push(Buffer.concat(frames))
  expect(decoded.find(frame => frame.streamId === 3)).toMatchObject({ type: 'start', status: 503 })
  active = false
  await expect(host.updateTasks('lock')).resolves.toBe(false)
})

it('drains native remote-stream opening and refuses new streams while locked', async () => {
  const entered = Promise.withResolvers<undefined>()
  const open = Promise.withResolvers<undefined>()
  const finish = Promise.withResolvers<undefined>()
  let active = false
  const f = await fixture({ async openStream(_endpoint, _payload, signal) {
    entered.resolve(undefined)
    await open.promise
    active = true
    signal.addEventListener('abort', () => { finish.resolve(undefined) }, { once: true })
    return (async function* () { yield 'ready'; await finish.promise })()
  } })
  const frames: Buffer[] = []
  const host = await runDesktopHost(f.project, async (frame) => { frames.push(frame) }, { primaryRuntime: f.primaryRuntime })
  onTestFinished(() => host.dispose())
  vi.spyOn(f.context().get('jobs')!, 'list').mockImplementation(() => active ? [{ status: 'running' } as never] : [])
  const command = { streamId: 1, request: { url: 'dsh-app://app/.dsh/remote-stream', method: 'POST', headers: [] } }
  const run = host.fetch(command, new Response(JSON.stringify({ endpoint: 'tasks.start', payload: {} })).body)
  onTestFinished(async () => { open.resolve(undefined); finish.resolve(undefined); await run })
  await entered.promise
  let finished = false
  const lock = host.updateTasks('lock').then((result) => { finished = true; return result })
  await host.fetch({ ...command, streamId: 2 }, null)
  expect(finished).toBe(false)
  open.resolve(undefined)
  await expect(lock).resolves.toBe(true)
  active = false
  await expect(host.updateTasks('lock')).resolves.toBe(false)
  const decoded = new DesktopHostResponseDecoder().push(Buffer.concat(frames))
  expect(decoded.find(frame => frame.streamId === 2)).toMatchObject({ type: 'start', status: 503 })
  host.cancel(1)
  await run
})
