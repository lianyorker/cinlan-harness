/** Opt-in official download and real browser acceptance through the Loader-owned native provider. */
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Browser from '@deepseek-ai/dsh-browser'
import FileSettings from '@deepseek-ai/dsh-settings-file'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import BrowserController from '../../../api/browser-controller/src/index.ts'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { expect, it, vi } from 'vitest'
import Runtime from '../src/runtime.ts'
import * as Provider from '../src/index.ts'

const managedDownload = process.env.DSH_BROWSER_RUNTIME_SMOKE === '1'
it.runIf(managedDownload || process.env.DSH_BROWSER_SYSTEM_SMOKE === '1')('launches, navigates and observes through Harness with an isolated profile', async () => {
  const proxy = process.env.DSH_BROWSER_SMOKE_PROXY
  if (proxy) {
    vi.stubEnv('HTTPS_PROXY', proxy)
    vi.stubEnv('HTTP_PROXY', proxy)
    vi.stubEnv('NO_PROXY', 'localhost,127.0.0.1')
  }
  const root = await mkdtemp(join(tmpdir(), 'dsh-browser-real-'))
  const ctx = new Context()
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Harness native acceptance</title><button aria-label="Controlled fixture">Continue</button>')
  })
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fixture server did not bind')
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, JSON.stringify([
      { name: 'settings', config: { path: join(root, 'settings.json'), watch: false } },
      { name: 'subprocess' }, { name: 'runtime', config: { storageDir: join(root, 'runtime'), installTimeoutMs: 600_000 } },
      { name: 'browser' },
      { name: 'provider', config: { browserChannel: managedDownload ? 'chromium' : 'chrome', headless: true, storageDir: join(root, 'owned-profile') } },
      { name: 'typert' }, { name: 'controller' },
    ]))
    const modules = new Map<string, unknown>([
      ['settings', FileSettings], ['subprocess', LocalSubprocess], ['runtime', Runtime],
      ['browser', Browser], ['provider', Provider], ['typert', TypertRegistry], ['controller', BrowserController],
    ])
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    // Loader only consumes import here; the test module map does not implement the production module registry.
    ctx.loader.internal = { version: 'v2', async import(name: string) { return modules.get(name) } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    const signal = new AbortController().signal
    const before = ctx.browserController.runtimeStatus(signal)
    expect(before).toMatchObject({ providerActive: true, source: managedDownload ? 'managed' : 'system', browserState: 'stopped' })
    if (managedDownload) {
      expect(before.installed).toBe(false)
      ctx.browserController.installRuntime(signal)
      await vi.waitFor(() => { expect(ctx.browserController.runtimeTask(signal)?.state).not.toBe('running') }, { timeout: 610_000, interval: 250 })
      expect(ctx.browserController.runtimeTask(signal)).toMatchObject({ state: 'succeeded' })
    }
    const installed = ctx.browserController.runtimeStatus(signal)
    expect(installed).toMatchObject({ installed: true, browserState: 'stopped' })
    const page = await ctx.browser.openPage({ url: 'about:blank' })
    await ctx.browser.navigate({ pageId: page.pageId, url: 'http://127.0.0.1:' + String(address.port) })
    const observation = await ctx.browser.snapshot({ pageId: page.pageId })
    expect(observation.tree).toContain('Controlled fixture')
    expect(ctx.browserController.runtimeStatus(signal).browserState).toBe('running')
    expect(() => ctx.browserController.removeRuntime(signal)).toThrow('Close the native browser')
    await ctx.browser.closePage({ pageId: page.pageId })
    await ctx.browserController.closeRuntime(signal)
    expect(ctx.browserController.runtimeStatus(signal).browserState).toBe('stopped')
    ctx.browserController.removeRuntime(signal)
    // Removing a complete browser tree pays Windows filesystem teardown, not the default one-second assertion budget.
    await vi.waitFor(() => { expect(ctx.browserController.runtimeTask(signal)?.state).not.toBe('running') }, { timeout: 30_000 })
    expect(ctx.browserController.runtimeTask(signal)?.state).toBe('succeeded')
    expect(ctx.browserController.runtimeStatus(signal).managedInstalled).toBe(false)
    console.log(JSON.stringify({ playwrightVersion: installed.playwrightVersion, browserVersion: installed.browserVersion, revision: installed.revision, origins: installed.downloadOrigins, observed: 'Controlled fixture', profileIsolation: true }))
  } finally {
    await ctx.fiber.dispose()
    await new Promise<void>(resolve => server.close(() =>{  resolve() }))
    await rm(root, { recursive: true, force: true })
    vi.unstubAllEnvs()
  }
}, 650_000)
