/** Real profile settings apply capture without replacing the Worker and persist the requested state. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import { expect, it, onTestFinished } from 'vitest'
import { profileComposition } from '../../../settings/settings/tests/profile-composition.ts'
import * as Inspector from '../src/index.ts'

it('saves live capture state, preserves the Worker, and restores the choice at cold restart', async () => {
  const home = await mkdtemp(join(tmpdir(), 'inspector-capture-settings-'))
  const contexts: Context[] = []
  const originalFetch = globalThis.fetch
  onTestFinished(async () => {
    for (const ctx of contexts) await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
    expect(globalThis.fetch === originalFetch).toBe(true)
  })
  const start = async () => {
    const ctx = new Context()
    contexts.push(ctx)
    ctx.baseUrl = pathToFileURL(home + '/').href
    await ctx.plugin(Loader).await()
    Object.assign(ctx.loader.builtins, {
      'capture-web-server': WebServer,
      'capture-connection': (child: Context) => { new HostConnectionService(child, [], {} as BrowserAuth) },
      'capture-inspector': Inspector,
    })
    const path = await profileComposition(ctx, home, fileURLToPath(new URL('./capture-settings.cordis.yml', import.meta.url)))
    return { ctx, path }
  }
  const { ctx, path } = await start()
  const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'experimental-inspector')!
  const uid = entry.fiber!.uid
  const initial = ctx.settings.describe().find(view => view.ns === 'experimental-inspector')!
  expect(initial.value).toEqual({ captureFetch: false })
  expect(initial.autoGenerate).toBe(false)
  expect(globalThis.fetch === originalFetch).toBe(true)
  await ctx.settings.mutate('experimental-inspector', [{ op: 'set', path: ['captureFetch'], value: true }], initial.revision)
  expect(entry.fiber!.uid).toBe(uid)
  expect(globalThis.fetch === originalFetch).toBe(false)
  expect(await readFile(path, 'utf8')).toContain('captureFetch: true')
  await ctx.fiber.dispose()
  expect(globalThis.fetch === originalFetch).toBe(true)
  const restored = await start()
  expect(restored.ctx.settings.describe().find(view => view.ns === 'experimental-inspector')!.value).toEqual({ captureFetch: true })
  expect(globalThis.fetch === originalFetch).toBe(false)
  await restored.ctx.settings.mutate('experimental-inspector', [{ op: 'unset', path: ['captureFetch'] }])
  expect(restored.ctx.settings.describe().find(view => view.ns === 'experimental-inspector')!.value).toEqual({ captureFetch: false })
  expect(globalThis.fetch === originalFetch).toBe(true)
})
