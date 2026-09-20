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

it('joins HMR configuration work, rejects nested profile edits, and queues detached descendants', async () => {
  const { ctx } = await fixture()
  const hmr = ctx.hmr
  const order: string[] = []
  await hmr.runExclusive(async () => {
    order.push('hmr')
    await runProfileConfiguration(ctx, async () => {
      order.push('profile')
      await expect(runProfileConfiguration(ctx, async () => {})).rejects.toThrow('cannot be nested')
    })
  })
  const trigger = Promise.withResolvers<undefined>()
  let descendant: Promise<unknown> | undefined
  await hmr.runExclusive(async () => {
    descendant = trigger.promise.then(() => runProfileConfiguration(ctx, async () => { order.push('descendant') }))
  })
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const held = hmr.runExclusive(async () => { entered.resolve(undefined); await release.promise; order.push('held') })
  onTestFinished(async () => { trigger.resolve(undefined); release.resolve(undefined); await Promise.allSettled([held, descendant]) })
  await entered.promise
  trigger.resolve(undefined)
  await Promise.resolve()
  expect(order).toEqual(['hmr', 'profile'])
  release.resolve(undefined)
  await held
  await descendant
  expect(order).toEqual(['hmr', 'profile', 'held', 'descendant'])
})

it('disposes HMR from its own profile mutation without waiting for itself and refuses queued work', async () => {
  const { ctx } = await fixture()
  const hmr = ctx.hmr
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const active = runProfileConfiguration(ctx, async () => {
    entered.resolve(undefined)
    await release.promise
    await ctx.fiber.dispose()
  })
  await entered.promise
  const queued = hmr.runExclusive(async () => { throw new Error('must not run') })
  const rejected = expect(queued).rejects.toThrow('disposed')
  release.resolve(undefined)
  await active
  await rejected
  await expect(hmr.runExclusive(async () => {})).rejects.toThrow('disposed')
})

it('joins active HMR configuration during external root disposal', async () => {
  const { ctx } = await fixture()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const active = runProfileConfiguration(ctx, async () => { entered.resolve(undefined); await release.promise })
  onTestFinished(async () => { release.resolve(undefined); await active })
  await entered.promise
  let finished = false
  const disposal = ctx.fiber.dispose().then(() => { finished = true })
  await Promise.resolve()
  expect(finished).toBe(false)
  release.resolve(undefined)
  await disposal
  expect(finished).toBe(true)
})

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
