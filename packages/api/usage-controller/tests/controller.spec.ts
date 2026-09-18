import { afterEach, describe, expect, it, vi } from 'vitest'
import { remoteMethods, RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { UsageQueryError } from '@deepseek-ai/dsh-usage-query'
import { createHarness } from './harness.ts'
import { interval, knownTokens } from './fixture.ts'

afterEach(() => { vi.restoreAllMocks() })

describe('UsageController', () => {
  it('binds one direct query and preserves the query request, signal, and result', async () => {
    const { ctx } = await createHarness()
    expect(ctx.usageController.typertRemote).toMatchObject({ serviceKey: 'usageController', namespace: 'usage' })
    expect(remoteMethods(ctx.usageController)).toEqual([{ method: 'query', invocation: { kind: 'direct' } }])
    const query = vi.spyOn(ctx.usageQuery, 'query')
    const request = { ...interval, provider: 'deepseek', model: 'deepseek-chat' }
    const signal = new AbortController().signal
    const result = await ctx.usageController.query(request, signal)
    expect(query).toHaveBeenCalledExactlyOnceWith(request, signal)
    expect(query.mock.calls[0]![0]).toBe(request)
    expect(query.mock.calls[0]![1]).toBe(signal)
    expect(result).toBe(await query.mock.results[0]!.value)
    expect(result).toMatchObject({ request, totals: { turns: 1, knownTurns: 1, tokens: knownTokens } })
  })

  it('rejects an already cancelled call before reaching usage storage', async () => {
    const { ctx, persistence } = await createHarness()
    const query = vi.spyOn(ctx.usageQuery, 'query')
    const list = vi.spyOn(persistence, 'list')
    const reason = new Error('caller stopped')
    await expect(ctx.usageController.query(interval, AbortSignal.abort(reason))).rejects.toBe(reason)
    expect(query).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })

  it.each([
    [new UsageQueryError('invalid-query', 'private invalid range details'), 'usage/invalid-query', 'Choose a valid usage interval and route filter'],
    [new UsageQueryError('timeout', 'private I/O timeout details'), 'usage/query-timeout', 'Usage query timed out; choose a shorter interval'],
    [new UsageQueryError('disposed', 'private teardown details'), 'usage/query-failed', 'Usage query failed; refresh and try again'],
    [new Error('secret-key private/session.jsonl'), 'usage/query-failed', 'Usage query failed; refresh and try again'],
  ])('sanitizes %s without retaining a cause', async (failure, code, message) => {
    const { ctx } = await createHarness()
    vi.spyOn(ctx.usageQuery, 'query').mockRejectedValueOnce(failure)
    const caught: unknown = await ctx.usageController.query(interval, new AbortController().signal).catch((error: unknown) => error)
    expect(caught).toBeInstanceOf(RemoteError)
    expect(caught).toMatchObject({ code, message, details: {} })
    expect(caught).not.toHaveProperty('cause')
    expect(JSON.stringify(caught)).not.toContain(failure.message)
  })

  it('preserves caller cancellation when a concurrent backend failure settles', async () => {
    const { ctx } = await createHarness()
    const abort = new AbortController()
    const reason = new Error('caller cancellation')
    vi.spyOn(ctx.usageQuery, 'query').mockImplementationOnce(async () => {
      abort.abort(reason)
      throw new Error('private backend failure')
    })
    await expect(ctx.usageController.query(interval, abort.signal)).rejects.toBe(reason)
  })
})
