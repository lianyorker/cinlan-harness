/** Profile management and exact-file watching share a queue and the local resolver. */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Hmr from '@deepseek-ai/cordis-plugin-hmr'
import Timer from '@deepseek-ai/cordis-plugin-timer'
import { expect, it, onTestFinished, vi } from 'vitest'
import {
  boot, initProfile, readProfilePatches, runProfileConfiguration, watchProfilePatches, type ProfileContext,
} from '../src/index.ts'

it('serializes profile operations, rejects nesting and admits work after a failure', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const order: string[] = []
  const first = runProfileConfiguration(ctx, async () => {
    order.push('first')
    entered.resolve(undefined)
    await release.promise
    await expect(runProfileConfiguration(ctx, async () => {})).rejects.toThrow('cannot be nested')
    throw new Error('first operation failed')
  })
  const failure = expect(first).rejects.toThrow('first operation failed')
  const second = runProfileConfiguration(ctx, async () => { order.push('second'); return 42 })
  onTestFinished(async () => { release.resolve(undefined); await Promise.allSettled([first, second]) })
  await entered.promise
  expect(order).toEqual(['first'])
  release.resolve(undefined)
  await failure
  expect(await second).toBe(42)
  expect(order).toEqual(['first', 'second'])
  await ctx.fiber.dispose()
  await expect(runProfileConfiguration(ctx, async () => {})).rejects.toThrow('disposed')
})

it('awaits an in-flight configuration operation during root disposal', async () => {
  const ctx = new Context()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const operation = runProfileConfiguration(ctx, async () => { entered.resolve(undefined); await release.promise })
  onTestFinished(async () => { release.resolve(undefined); await operation; await ctx.fiber.dispose() })
  await entered.promise
  let disposed = false
  const disposal = ctx.fiber.dispose().then(() => { disposed = true })
  await Promise.resolve(undefined)
  expect(disposed).toBe(false)
  release.resolve(undefined)
  await disposal
  expect(disposed).toBe(true)
})

async function fixture(initialPatch = '[]\n') {
  const home = mkdtempSync(join(tmpdir(), 'profile-configuration-'))
  let ctx: Context | undefined = undefined
  onTestFinished(async () => { await ctx?.fiber.dispose(); rmSync(home, { recursive: true, force: true }) })
  const dir = join(home, 'profiles', 'test')
  const installAnchor = join(home, 'package.json')
  writeFileSync(installAnchor, '{"name":"installation","dependencies":{}}\n')
  initProfile(dir, ['first'])
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  for (const name of ['first', 'second']) {
    const bundle = join(dir, 'node_modules', name)
    mkdirSync(bundle, { recursive: true })
    writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name, version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    writeFileSync(join(bundle, 'plugin.mjs'), 'export function apply(ctx, config) { ctx.provide(config.key, config.value) }\n')
    writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: name, name: './plugin.mjs', config: { key: name, value: 1 } }] }]))
  }
  const profile: ProfileContext = {
    name: 'test', dir, home, patchPath: join(dir, 'cordis.patch.yml'), installAnchor,
    cwd: home, startedBundles: ['first'], overlays: [], telemetryDisabledEnv: undefined, patchReload: 'live',
  }
  writeFileSync(profile.patchPath, initialPatch)
  ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile))
  await ctx.plugin(Timer)
  await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
  return { ctx, profile }
}

it('watches bundle selection and both user layers, preserving higher-priority home overrides', async () => {
  const { ctx, profile } = await fixture()
  const dispose = await watchProfilePatches(ctx, profile, 'test')
  expect(ctx.get('first')).toBe(1)
  const manifest = JSON.parse(readFileSync(join(profile.dir, 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }
  manifest.dsh.profile.bundles = ['second']
  writeFileSync(join(profile.dir, 'package.json'), JSON.stringify(manifest))
  await vi.waitFor(() => { expect(ctx.get('first')).toBeUndefined(); expect(ctx.get('second')).toBe(1) })
  writeFileSync(profile.patchPath, '- id: second\n  config: { key: second, value: 2 }\n')
  await vi.waitFor(() => { expect(ctx.get('second')).toBe(2) })
  writeFileSync(join(profile.home, 'cordis.patch.yml'), '- id: second\n  config: { key: second, value: 3 }\n')
  await vi.waitFor(() => { expect(ctx.get('second')).toBe(3) })
  await dispose()
  writeFileSync(profile.patchPath, '- id: second\n  disabled: true\n')
  await runProfileConfiguration(ctx, async () => {})
  expect(ctx.get('second')).toBe(3)
})

it('applies a patch written after boot before reporting its watchers ready', async () => {
  const { ctx, profile } = await fixture()
  writeFileSync(profile.patchPath, '- id: first\n  config: { key: first, value: 2 }\n')
  expect(ctx.get('first')).toBe(1)
  await watchProfilePatches(ctx, profile, 'test')
  expect(ctx.get('first')).toBe(2)
})

it('reverts a patch removed after boot before reporting its watchers ready', async () => {
  const { ctx, profile } = await fixture('- id: first\n  config: { key: first, value: 2 }\n')
  rmSync(profile.patchPath)
  expect(ctx.get('first')).toBe(2)
  await watchProfilePatches(ctx, profile, 'test')
  expect(ctx.get('first')).toBe(1)
})

it('requires HMR only for live profiles', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const profile = { patchReload: 'startup' } as ProfileContext
  await expect(watchProfilePatches(ctx, profile)).resolves.toBeTypeOf('function')
  await expect(watchProfilePatches(ctx, { ...profile, patchReload: 'live' })).rejects.toThrow('requires the Cordis HMR service')
})
