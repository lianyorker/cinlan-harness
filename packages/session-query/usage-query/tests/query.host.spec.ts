import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Config } from '../src/index.ts'
import { completeTurn, context, event, header, message, persist, retryTurn, usage } from './fixtures.ts'

const contexts: Context[] = []
const roots: string[] = []
const request = { from: 1000, to: 2000 }
const signal = (): AbortSignal => new AbortController().signal
async function fixture(config: Partial<Config> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-usage-query-'))
  roots.push(root)
  const ctx = await context(root, config)
  contexts.push(ctx)
  return { ctx, root }
}
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('durable own-Turn usage queries', () => {
  it('reads durable logs after restart without publishing or activating Sessions', async () => {
    const { ctx: writer, root } = await fixture()
    await persist(writer, header('saved', root), completeTurn())
    await writer.fiber.dispose()
    const reader = await context(root); contexts.push(reader)
    const created = vi.fn()
    reader.on('session/created', created)
    const result = await reader.usageQuery.query(request, signal())
    expect(result).toMatchObject({
      partial: false, scannedSessions: 1, skippedSessions: 0, examinedEvents: 5,
      totals: { turns: 1, knownTurns: 1, unknownTurns: 0, attempts: 1, retries: 0,
        tokens: { uncachedInputTokens: 100, outputTokens: 20, totalTokens: 170, cacheReadTokens: 50 } },
      rows: [{ provider: 'deepseek', model: 'chat', turns: 1 }],
    })
    expect(created).not.toHaveBeenCalled()
    expect(reader.sessions.get(SessionId('saved'))).toBeUndefined()
    expect(reader.get('agents')).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('private fixture answer')
  })

  it('counts retry attempts once and does not invent their model attribution', async () => {
    const { ctx, root } = await fixture()
    await persist(ctx, header('retried', root), retryTurn())
    const result = await ctx.usageQuery.query(request, signal())
    expect(result.totals).toMatchObject({
      turns: 1, knownTurns: 1, attempts: 2, retries: 1,
      tokens: { totalTokens: 240, uncachedInputTokens: 140, outputTokens: 30 },
    })
    expect(result.rows[0]?.provider).toBeUndefined()
    expect(result.unattributedTurns).toBe(1)
    const filtered = await ctx.usageQuery.query({ ...request, provider: 'deepseek' }, signal())
    expect(filtered).toMatchObject({ partial: true, reasons: ['unattributed-filter'], totals: { turns: 0, tokens: null } })
  })

  it('excludes fork-inherited work while counting a child Session own Turn', async () => {
    const { ctx, root } = await fixture()
    const inherited = completeTurn()
    await persist(ctx, header('parent', root), inherited)
    await persist(ctx, { ...header('child', root, true), parentSession: SessionId('parent') }, [
      ...inherited, event(5, 'session/end-seed', { inherited: true }),
      ...completeTurn(6, 2, usage(200), 'other', 'model'),
    ], inherited.length)
    const result = await ctx.usageQuery.query(request, signal())
    expect(result.totals).toMatchObject({ turns: 2, attempts: 2, tokens: { totalTokens: 370 } })
    expect(result.rows.map(row => [row.provider, row.tokens?.totalTokens])).toEqual([['deepseek', 170], ['other', 200]])
  })

  it('reports missing usage and interrupted live work instead of a fake zero', async () => {
    const { ctx, root } = await fixture()
    const missing = completeTurn()
    missing[2] = event(2, 'assistant/message', { turn: 1, step: 1, message: message(2).data.message, stream: [] })
    await persist(ctx, header('missing', root), missing)
    const result = await ctx.usageQuery.query(request, signal())
    expect(result).toMatchObject({ partial: true, reasons: ['unknown-usage'], totals: { knownTurns: 0, unknownTurns: 1, tokens: null } })
    vi.spyOn(Date, 'now').mockReturnValue(1500)
    const live = ctx.sessions.create(SessionId('live'), { meta: { createdAt: 1, cwd: root } })
    live.append('turn/start', { turn: 1 }); live.append('step/start', { turn: 1, step: 1 })
    const withLive = await ctx.usageQuery.query({ from: 0, to: Date.now() + 1 }, signal())
    expect(withLive.totals.unknownTurns).toBe(2)
  })

  it('prefers the exact live cut over a shorter durable prefix and refreshes after append', async () => {
    const { ctx, root } = await fixture()
    const saved = completeTurn()
    await persist(ctx, header('live-preferred', root), saved)
    vi.spyOn(Date, 'now').mockReturnValue(1500)
    const live = ctx.sessions.create(SessionId('live-preferred'), { seed: saved, meta: { createdAt: 1, cwd: root } })
    const first = await ctx.usageQuery.query({ from: 0, to: Date.now() + 1 }, signal())
    expect(first.totals.tokens?.totalTokens).toBe(170)
    live.append('turn/start', { turn: 2 })
    live.append('step/start', { turn: 2, step: 1 })
    live.append('assistant/message', message(2, usage(), 'deepseek', 'chat', 2).data, { surfaceOp: 'append' })
    live.append('step/end', { turn: 2, step: 1 })
    live.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    const next = await ctx.usageQuery.query({ from: 0, to: Date.now() + 1 }, signal())
    expect(next.totals.tokens?.totalTokens).toBe(340)
    expect(next.scannedSessions).toBe(1)
  })

  it('uses recorded Turn times even when the Host clock moved backward after Session creation', async () => {
    const { ctx, root } = await fixture()
    await persist(ctx, { ...header('clock-changed', root), createdAt: 3000 }, completeTurn())
    expect((await ctx.usageQuery.query(request, signal())).totals.tokens?.totalTokens).toBe(170)
  })

  it('filters using inclusive Turn starts and exclusive range ends', async () => {
    const { ctx, root } = await fixture()
    await persist(ctx, header('interval', root), [
      ...completeTurn(), ...completeTurn(5, 2, usage(200), 'other', 'model'),
    ])
    expect((await ctx.usageQuery.query({ from: 1005, to: 1006 }, signal())).totals.tokens?.totalTokens).toBe(200)
    const selected = await ctx.usageQuery.query({ ...request, provider: 'deepseek', model: 'chat' }, signal())
    expect(selected.totals.tokens?.totalTokens).toBe(170)
    expect(selected.providers).toEqual(['deepseek', 'other'])
    expect((await ctx.usageQuery.query({ ...request, model: 'absent' }, signal())).totals).toMatchObject({ turns: 0, tokens: null })
  })

  it('marks an own tail of an inherited Turn as unknown without charging inherited tokens', async () => {
    const { ctx, root } = await fixture()
    const complete = completeTurn()
    await persist(ctx, { ...header('partial-fork', root, true), parentSession: SessionId('ancestor') }, [
      ...complete.slice(0, 2), event(2, 'session/end-seed', { inherited: true }),
      ...complete.slice(2).map((entry, index) => ({ ...entry, seq: (index + 3) as typeof entry.seq })),
    ], 2)
    const result = await ctx.usageQuery.query(request, signal())
    expect(result).toMatchObject({
      partial: true, reasons: ['inherited-boundary', 'unknown-usage'],
      totals: { turns: 1, unknownTurns: 1, attempts: 0, tokens: null },
    })
  })

  it('distinguishes a reported zero from no matching accounting', async () => {
    const { ctx, root } = await fixture()
    await persist(ctx, header('zero', root), completeTurn(0, 1, { inputTokens: 0, outputTokens: 0, totalTokens: 0 }))
    expect((await ctx.usageQuery.query(request, signal())).totals).toMatchObject({ knownTurns: 1, tokens: { totalTokens: 0 } })
    expect((await ctx.usageQuery.query({ from: 1100, to: 1200 }, signal())).totals.tokens).toBeNull()
  })

  it('marks bounded source coverage and read failures without leaking errors', async () => {
    const { ctx, root } = await fixture({ maxSessions: 1 })
    await persist(ctx, header('one', root), completeTurn())
    await persist(ctx, header('two', root), completeTurn())
    expect(await ctx.usageQuery.query(request, signal())).toMatchObject({ partial: true, skippedSessions: 1, reasons: ['session-limit'] })
    vi.spyOn(ctx.sessionQuery, 'observeSession').mockRejectedValue(new Error('sensitive host path'))
    const failed = await ctx.usageQuery.query(request, signal())
    expect(failed.reasons).toEqual(['session-limit', 'source-error'])
    expect(JSON.stringify(failed)).not.toContain('sensitive host path')
  })

  it.each([4, 5])('respects an event budget of %i at its exact boundary', async (maxEvents) => {
    const { ctx, root } = await fixture({ maxEvents })
    await persist(ctx, header('bounded', root), completeTurn())
    const result = await ctx.usageQuery.query(request, signal())
    expect(result.totals.turns).toBe(maxEvents === 5 ? 1 : 0)
    expect(result.reasons).toEqual(maxEvents === 5 ? [] : ['event-limit'])
  })

  it('propagates pre-admission and in-flight cancellation to the source', async () => {
    const { ctx } = await fixture()
    const controller = new AbortController()
    controller.abort(new Error('cancelled before admission'))
    const list = vi.spyOn(ctx.sessionQuery, 'listSessions')
    await expect(ctx.usageQuery.query(request, controller.signal)).rejects.toThrow('cancelled before admission')
    expect(list).not.toHaveBeenCalled()
    const active = new AbortController()
    list.mockImplementation(async activeSignal => await new Promise((_resolve, reject) => {
      activeSignal!.addEventListener('abort', () => { reject(activeSignal!.reason as Error) }, { once: true })
    }))
    const pending = ctx.usageQuery.query(request, active.signal)
    const rejected = expect(pending).rejects.toThrow('cancelled during read')
    active.abort(new Error('cancelled during read'))
    await rejected
  })

  it('aborts and awaits source settlement when its owner unloads', async () => {
    const { ctx } = await fixture()
    let settled = false
    vi.spyOn(ctx.sessionQuery, 'listSessions').mockImplementation(async activeSignal => await new Promise((_resolve, reject) => {
      activeSignal!.addEventListener('abort', () => { queueMicrotask(() => { settled = true; reject(activeSignal!.reason as Error) }) }, { once: true })
    }))
    const service = ctx.usageQuery
    const pending = service.query(request, signal())
    const rejected = expect(pending).rejects.toMatchObject({ code: 'disposed' })
    await ctx.fiber.dispose()
    await rejected
    expect(settled).toBe(true)
    await expect(service.query(request, signal())).rejects.toMatchObject({ code: 'disposed' })
  })

  it('enforces the configured deadline and accepts no inverted or oversized interval', async () => {
    const { ctx } = await fixture({ timeoutMs: 100, maxRangeDays: 1 })
    await expect(ctx.usageQuery.query({ from: 2000, to: 1000 }, signal())).rejects.toMatchObject({ code: 'invalid-query' })
    await expect(ctx.usageQuery.query({ from: 0, to: 86_400_001 }, signal())).rejects.toMatchObject({ code: 'invalid-query' })
    vi.spyOn(ctx.sessionQuery, 'listSessions').mockImplementation(async activeSignal => await new Promise((_resolve, reject) => {
      activeSignal!.addEventListener('abort', () => { reject(activeSignal!.reason as Error) }, { once: true })
    }))
    vi.useFakeTimers()
    const rejected = expect(ctx.usageQuery.query(request, signal())).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(100)
    await rejected
  })
})
