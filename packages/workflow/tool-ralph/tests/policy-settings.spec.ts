/** Ralph admission and budgets persist through the real profile editor without starting workers. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { expect, it, onTestFinished } from 'vitest'
import { profileComposition } from '../../../settings/settings/tests/profile-composition.ts'
import RalphPolicy from '../src/settings.ts'

it('persists opt-in and a round ceiling and restores both at Host restart', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ralph-policy-'))
  const contexts: Context[] = []
  onTestFinished(async () => {
    for (const ctx of contexts) await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  })
  const start = async () => {
    const ctx = new Context()
    contexts.push(ctx)
    ctx.baseUrl = pathToFileURL(home + '/').href
    await ctx.plugin(Loader).await()
    ctx.loader.builtins['ralph-policy-fixture'] = RalphPolicy
    const path = await profileComposition(ctx, home, fileURLToPath(new URL('./policy-settings.cordis.yml', import.meta.url)))
    return { ctx, path }
  }
  const { ctx, path } = await start()
  const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'ralph-policy')!
  const uid = entry.fiber!.uid
  const initial = ctx.settings.describe().find(view => view.ns === 'ralph-policy')!
  expect(initial.value).toEqual({ enabled: false, maxRounds: 64 })
  expect(initial.autoGenerate).toBe(false)
  await ctx.settings.mutate('ralph-policy', [
    { op: 'set', path: ['enabled'], value: true }, { op: 'set', path: ['maxRounds'], value: 3 },
  ], initial.revision)
  expect(entry.fiber!.uid).toBe(uid)
  expect(ctx.ralphPolicy.current()).toEqual({ enabled: true, maxRounds: 3 })
  expect(await readFile(path, 'utf8')).toContain('maxRounds: 3')
  await expect(ctx.settings.mutate('ralph-policy', [{ op: 'set', path: ['maxRounds'], value: 0 }])).rejects.toThrow()
  expect(ctx.ralphPolicy.current()).toEqual({ enabled: true, maxRounds: 3 })
  await ctx.fiber.dispose()
  const restored = await start()
  expect(restored.ctx.ralphPolicy.current()).toEqual({ enabled: true, maxRounds: 3 })
  await restored.ctx.settings.mutate('ralph-policy', [
    { op: 'unset', path: ['enabled'] }, { op: 'unset', path: ['maxRounds'] },
  ])
  expect(restored.ctx.ralphPolicy.current()).toEqual({ enabled: false, maxRounds: 64 })
})
