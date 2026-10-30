/** Automatic title choices persist through the real profile editor and cold Host restart. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { expect, it, onTestFinished } from 'vitest'
import { profileComposition } from '../../../settings/settings/tests/profile-composition.ts'
import SessionTitleService from '../src/index.ts'

it('saves the automatic title setting and restores it without duplicating generated settings', async () => {
  const home = await mkdtemp(join(tmpdir(), 'title-settings-'))
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
    Object.assign(ctx.loader.builtins, {
      'title-test-sessions': SessionStore,
      'title-test-projections': SessionProjectionRegistry,
      'title-test-service': SessionTitleService,
    })
    const path = await profileComposition(ctx, home, fileURLToPath(new URL('./profile-settings.cordis.yml', import.meta.url)))
    return { ctx, path }
  }
  const { ctx, path } = await start()
  const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'session-title')!
  const uid = entry.fiber!.uid
  const initial = ctx.settings.describe().find(view => view.ns === 'session-title')!
  expect(initial.value).toEqual({ automaticEnabled: true })
  expect(initial.autoGenerate).toBe(false)
  await ctx.settings.mutate('session-title', [{ op: 'set', path: ['automaticEnabled'], value: false }], initial.revision)
  expect(entry.fiber!.uid).toBe(uid)
  expect(ctx.settings.describe().find(view => view.ns === 'session-title')!.value).toEqual({ automaticEnabled: false })
  expect(await readFile(path, 'utf8')).toContain('automaticEnabled: false')
  await ctx.fiber.dispose()
  const restored = await start()
  expect(restored.ctx.settings.describe().find(view => view.ns === 'session-title')!.value).toEqual({ automaticEnabled: false })
  await restored.ctx.settings.mutate('session-title', [{ op: 'unset', path: ['automaticEnabled'] }])
  expect(restored.ctx.settings.describe().find(view => view.ns === 'session-title')!.value).toEqual({ automaticEnabled: true })
})
