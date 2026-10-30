/** Search admission survives real profile writes and Host restart without changing deployment policy. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { expect, it, onTestFinished } from 'vitest'
import { profileComposition } from '../../../settings/settings/tests/profile-composition.ts'
import SqliteSessionQueryEngine from '../src/index.ts'

it('persists content search admission and restores it at cold restart', async () => {
  const home = await mkdtemp(join(tmpdir(), 'search-profile-'))
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
      'search-test-sessions': SessionStore,
      'search-test-projections': SessionProjectionRegistry,
      'search-test-service': SqliteSessionQueryEngine,
    })
    const path = await profileComposition(ctx, home, fileURLToPath(new URL('./profile-settings.cordis.yml', import.meta.url)))
    return { ctx, path }
  }
  const { ctx, path } = await start()
  const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'session-query-sqlite')!
  const uid = entry.fiber!.uid
  const initial = ctx.settings.describe().find(view => view.ns === 'session-query-sqlite')!
  expect(initial.value).toEqual({ searchEnabled: true })
  expect(initial.autoGenerate).toBe(false)
  await ctx.settings.mutate('session-query-sqlite', [{ op: 'set', path: ['searchEnabled'], value: false }], initial.revision)
  expect(entry.fiber!.uid).toBe(uid)
  expect(ctx.settings.describe().find(view => view.ns === 'session-query-sqlite')!.value).toEqual({ searchEnabled: false })
  expect(await readFile(path, 'utf8')).toContain('searchEnabled: false')
  await ctx.fiber.dispose()
  const restored = await start()
  expect(restored.ctx.settings.describe().find(view => view.ns === 'session-query-sqlite')!.value).toEqual({ searchEnabled: false })
  const session = restored.ctx.sessions.create(SessionId('restored-search'))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'persistent choice needle' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await expect(restored.ctx.sessionQuery.searchSessions({ query: 'needle' }))
    .rejects.toMatchObject({ code: 'SESSION_QUERY_SEARCH_DISABLED' })
  expect((await restored.ctx.sessionQuery.readSession(session.id)).events).toHaveLength(3)
  await restored.ctx.settings.mutate('session-query-sqlite', [{ op: 'unset', path: ['searchEnabled'] }])
  expect(restored.ctx.settings.describe().find(view => view.ns === 'session-query-sqlite')!.value).toEqual({ searchEnabled: true })
  expect((await restored.ctx.sessionQuery.searchSessions({ query: 'needle' })).items).toHaveLength(1)
})
