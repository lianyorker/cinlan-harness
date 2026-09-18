import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHarness, holdColdOpen, serveApi } from './harness.ts'
import { interval, knownTokens, privateText } from './fixture.ts'

afterEach(() => { vi.restoreAllMocks() })

const known = { turns: 1, knownTurns: 1, unknownTurns: 0, attempts: 1, retries: 0 }
const unknown = { turns: 1, knownTurns: 0, unknownTurns: 1, attempts: 1, retries: 0, tokens: null }

function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
}

function failure(code: string, message: string) {
  return { type: 'server-response', rpcId: 'usage-request', result: { ok: false, error: { code, message, details: {} } } }
}

describe('usage real Loader and authenticated API', () => {
  it('rejects unauthenticated calls before reads and returns exact cold-log aggregates with authentication', async () => {
    const { ctx, routes, persistence, paths } = await createHarness()
    const api = await serveApi(ctx, routes)
    const bytes = await Promise.all(paths.map(path => readFile(path)))
    const query = vi.spyOn(ctx.usageQuery, 'query')
    const list = vi.spyOn(persistence, 'list')
    const open = vi.spyOn(persistence, 'open')
    const attach = vi.spyOn(ctx.sessions, 'create')
    expect(ctx.sessions.list()).toEqual([])
    expect(ctx.get('agents')).toBeUndefined()

    const denied = await api.query(interval, {})
    expect(denied.status).toBe(401)
    expect(await denied.text()).toBe('unauthorized')
    const invalidCookie = await api.query(interval, { cookie: api.cookie + 'tampered' })
    expect(invalidCookie.status).toBe(401)
    expect(await invalidCookie.text()).toBe('unauthorized')
    expect(query).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()

    const response = await api.query(interval)
    expect(response.status).toBe(200)
    const body: unknown = await response.json()
    expect(body).toEqual({
      type: 'server-response', rpcId: 'usage-request', result: { ok: true, value: {
        request: interval, generatedAt: expect.any(Number) as unknown,
        totals: {
          turns: 3, knownTurns: 2, unknownTurns: 1, attempts: 3, retries: 0,
          tokens: {
            uncachedInputTokens: 110, outputTokens: 25, totalTokens: 187, cacheReadTokens: 52, cacheWriteTokens: 0, reasoningTokens: 9,
          },
        },
        rows: [
          { provider: 'deepseek', model: 'deepseek-chat', ...known, tokens: knownTokens },
          { provider: 'other', model: 'reasoner', ...known, tokens: {
            uncachedInputTokens: 10, outputTokens: 5, totalTokens: 17, cacheReadTokens: 2, cacheWriteTokens: 0, reasoningTokens: 1,
          } },
          unknown,
        ],
        providers: ['deepseek', 'other'], models: ['deepseek-chat', 'reasoner'],
        scannedSessions: 2, skippedSessions: 0, examinedEvents: 20, unattributedTurns: 1,
        partial: true, reasons: ['unknown-usage'],
      } },
    })
    expect(query).toHaveBeenCalledOnce()
    expect(list).toHaveBeenCalledOnce()
    expect(open).toHaveBeenCalledTimes(2)
    expect(open.mock.calls.every(([, access]) => access === 'read')).toBe(true)
    expect(attach).not.toHaveBeenCalled()
    expect(ctx.sessions.list()).toEqual([])
    expect(ctx.get('agents')).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain(privateText)
    await expect(Promise.all(paths.map(path => readFile(path)))).resolves.toEqual(bytes)
  })

  it('carries both route filters and keeps unknown attribution explicit', async () => {
    const { ctx, routes } = await createHarness()
    const api = await serveApi(ctx, routes)
    const request = { ...interval, provider: 'deepseek', model: 'deepseek-chat' }
    const query = vi.spyOn(ctx.usageQuery, 'query')
    const response = await api.query(request)
    expect(await response.json()).toEqual({
      type: 'server-response', rpcId: 'usage-request', result: { ok: true, value: {
        request, generatedAt: expect.any(Number) as unknown, totals: { ...known, tokens: knownTokens },
        rows: [{ provider: 'deepseek', model: 'deepseek-chat', ...known, tokens: knownTokens }],
        providers: ['deepseek', 'other'], models: ['deepseek-chat', 'reasoner'],
        scannedSessions: 2, skippedSessions: 0, examinedEvents: 20, unattributedTurns: 1,
        partial: true, reasons: ['unattributed-filter'],
      } },
    })
    expect(query.mock.calls[0]?.[0]).toEqual(request)
    expect(query.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal)
  })

  it('returns sanitized validation errors without listing logs', async () => {
    const { ctx, routes, persistence } = await createHarness()
    const api = await serveApi(ctx, routes)
    const list = vi.spyOn(persistence, 'list')
    const response = await api.query({ from: interval.to, to: interval.from })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(failure('usage/invalid-query', 'Choose a valid usage interval and route filter'))
    expect(list).not.toHaveBeenCalled()
  })

  it('sanitizes storage failure paths and private diagnostics on the actual wire', async () => {
    const { ctx, routes, persistence, root } = await createHarness()
    const api = await serveApi(ctx, routes)
    vi.spyOn(persistence, 'list').mockRejectedValueOnce(new Error(root + ' secret-key ' + privateText))
    const response = await api.query(interval)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(failure('usage/query-failed', 'Usage query failed; refresh and try again'))
  })

  it('propagates HTTP cancellation through the aggregate to a real cold open', async () => {
    const { ctx, routes, persistence, paths } = await createHarness()
    const api = await serveApi(ctx, routes)
    const bytes = await Promise.all(paths.map(path => readFile(path)))
    const hold = holdColdOpen(persistence)
    const query = vi.spyOn(ctx.usageQuery, 'query')
    const abort = new AbortController()
    const request = api.query(interval, { cookie: api.cookie, signal: abort.signal }).catch((error: unknown) => error)
    const coldSignal = await hold.entered
    const transportSignal = query.mock.calls[0]![1]
    expect(transportSignal.aborted).toBe(false)
    expect(coldSignal.aborted).toBe(false)
    abort.abort()
    await aborted(coldSignal)
    expect(transportSignal.aborted).toBe(true)
    hold.release()
    await hold.settled
    await expect(query.mock.results[0]!.value).rejects.toBe(transportSignal.reason)
    expect(await request).toMatchObject({ name: 'AbortError' })
    expect(ctx.sessions.list()).toEqual([])
    await expect(Promise.all(paths.map(path => readFile(path)))).resolves.toEqual(bytes)
  })

  it('cancels a bounded query and sends only its stable timeout error', async () => {
    const { ctx, routes, persistence } = await createHarness({ timeoutMs: 1000 })
    const api = await serveApi(ctx, routes)
    const hold = holdColdOpen(persistence)
    const response = api.query(interval)
    const signal = await hold.entered
    await aborted(signal)
    hold.release()
    expect(await (await response).json()).toEqual(failure('usage/query-timeout', 'Usage query timed out; choose a shorter interval'))
    await hold.settled
    expect(ctx.sessions.list()).toEqual([])
  })

  it('withdraws the endpoint on unload, reloads it once, and removes transport registrations', async () => {
    const harness = await createHarness()
    const { ctx, routes, upgrades } = harness
    const api = await serveApi(ctx, routes)
    const initial = await api.query(interval)
    expect(initial.status).toBe(200)
    expect(await initial.json()).toMatchObject({ result: { ok: true, value: { totals: { knownTurns: 2 } } } })
    await harness.setEnabled('@deepseek-ai/dsh-api-usage-controller', false)
    expect(ctx.get('usageController')).toBeUndefined()
    const query = vi.spyOn(ctx.usageQuery, 'query')
    const withdrawn = await api.query(interval)
    expect(withdrawn.status).toBe(404)
    await withdrawn.text()
    expect(query).not.toHaveBeenCalled()
    await harness.setEnabled('@deepseek-ai/dsh-api-usage-controller', true)
    const restored = await api.query(interval)
    expect(restored.status).toBe(200)
    expect(await restored.json()).toMatchObject({ result: { ok: true, value: { totals: { knownTurns: 2 } } } })
    expect(query).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
    expect(routes).toEqual([])
    expect(upgrades).toEqual([])
  })

  it('propagates query-service disposal to an in-flight cold read', async () => {
    const harness = await createHarness()
    const { ctx, routes, persistence } = harness
    const api = await serveApi(ctx, routes)
    const hold = holdColdOpen(persistence)
    const response = api.query(interval)
    const signal = await hold.entered
    const disposed = harness.setEnabled('@deepseek-ai/dsh-usage-query', false)
    await aborted(signal)
    hold.release()
    expect(await (await response).json()).toEqual(failure('usage/query-failed', 'Usage query failed; refresh and try again'))
    await hold.settled
    await disposed
    expect(ctx.get('usageController')).toBeUndefined()
    expect(ctx.get('usageQuery')).toBeUndefined()
    expect(ctx.sessions.list()).toEqual([])
  })
})
