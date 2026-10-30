/** Live search admission is independent of index lifecycle and exact Session reads. */
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { expect, it, onTestFinished } from 'vitest'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'
import SqliteSessionQueryEngine from '../src/index.ts'

it.each(['startup', 'first-search'] as const)('keeps %s unopened while disabled and reuses the service across live changes', async (openAt) => {
  const directory = await mkdtemp(join(tmpdir(), 'search-settings-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  await ctx.plugin(SessionStore).await()
  await ctx.plugin(SessionProjectionRegistry).await()
  const path = join(directory, 'search.db')
  const live = await liveConfig(ctx, SqliteSessionQueryEngine, { path, openAt, searchEnabled: false })
  const uid = live.entry.fiber!.uid
  const session = ctx.sessions.create(SessionId('search-settings'))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'searchable needle' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await expect(ctx.sessionQuery.searchSessions({ query: 'needle' })).rejects.toMatchObject({ code: 'SESSION_QUERY_SEARCH_DISABLED' })
  await expect(ctx.sessionQuery.searchEvents({ sessionId: session.id, query: 'needle' }))
    .rejects.toMatchObject({ code: 'SESSION_QUERY_SEARCH_DISABLED' })
  await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
  expect((await ctx.sessionQuery.readSession(session.id)).events).toHaveLength(3)
  await live.update({ searchEnabled: true })
  expect(live.entry.fiber!.uid).toBe(uid)
  expect((await ctx.sessionQuery.searchSessions({ query: 'needle' })).items).toHaveLength(1)
  await expect(stat(path)).resolves.toBeDefined()
  await live.update({ searchEnabled: false })
  await expect(ctx.sessionQuery.searchSessions({ query: 'needle' })).rejects.toMatchObject({ code: 'SESSION_QUERY_SEARCH_DISABLED' })
  await expect(stat(path)).resolves.toBeDefined()
  await live.update({ searchEnabled: true })
  expect(live.entry.fiber!.uid).toBe(uid)
  expect((await ctx.sessionQuery.searchEvents({ sessionId: session.id, query: 'needle' })).items).toHaveLength(1)
})

it('does not override deployment openAt never when live search admission is enabled', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore).await()
  await liveConfig(ctx, SqliteSessionQueryEngine, { path: ':memory:', openAt: 'never', searchEnabled: true })
  await expect(ctx.sessionQuery.searchSessions({ query: 'needle' })).rejects.toMatchObject({ code: 'SESSION_QUERY_SEARCH_DISABLED' })
})
