/** Source-process acceptance for Node's actual module cache, HMR watcher, and persistent manager. */
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout } from 'node:timers/promises'
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import Hmr from '@deepseek-ai/cordis-plugin-hmr'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { boot, initProfile, readProfilePatches, watchProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import PluginManager from '../src/index.ts'

const home = await realpath(await mkdtemp(join(tmpdir(), 'manager-module-process-')))
const dir = join(home, 'profile')
const anchor = join(home, 'package.json')
const plugin = join(home, 'probe.mjs')
await writeFile(anchor, '{"name":"fixture","dependencies":{}}')
initProfile(dir, ['core'])
const bundle = join(dir, 'node_modules', 'core')
await mkdir(bundle, { recursive: true })
await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: 'core', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
  { id: 'manager', name: 'cordis:manager' }, { id: 'probe', name: pathToFileURL(plugin).href },
] }]))
await writeFile(plugin, 'export function apply(ctx) { ctx.provide("moduleProbe", 1) }\n')
await writeFile(join(dir, 'cordis.yml'), '[]\n')
const profile: ProfileContext = {
  name: 'test', patchReload: 'live', dir, home, patchPath: join(dir, 'cordis.patch.yml'),
  installAnchor: anchor, cwd: home, startedBundles: ['core'], overlays: [], telemetryDisabledEnv: undefined,
}
const start = (): Promise<Context> => boot('module-fixture', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (ctx: Context) => {
  ctx.provide('profileContext', profile)
  ctx.loader.builtins.manager = PluginManager
})
let ctx = await start()
try {
  assert.equal(ctx.get('moduleProbe'), 1)
  await ctx.plugin(Timer)
  await ctx.plugin(Hmr, { base: pathToFileURL(home).href + '/', root: [home], ignored: [], debounce: 5 })
  await watchProfilePatches(ctx, profile)
  await writeFile(plugin, 'export function apply(ctx) { ctx.provide("moduleProbe", 2) }\n')
  const deadline = Date.now() + 10_000
  while (ctx.get('moduleProbe') !== 2) {
    if (Date.now() > deadline) throw new Error('Actual Node module hot replacement did not publish generation 2')
    await setTimeout(20)
  }
  const row = (await ctx.pluginManager.listPlugins()).find(entry => entry.patchId === 'probe')!
  assert.equal((await ctx.pluginManager.setPluginEnabled(row.entryId, false)).application, 'applied')
  assert.equal(ctx.get('moduleProbe'), undefined)
  await ctx.fiber.dispose()
  ctx = await start()
  assert.equal(ctx.get('moduleProbe'), undefined)
  console.log('Actual module replacement, persistent management, and restart: passed')
} finally {
  await ctx.fiber.dispose()
  await rm(home, { recursive: true, force: true })
}
