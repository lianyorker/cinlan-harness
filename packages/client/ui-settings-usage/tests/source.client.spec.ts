import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UsageQueryResult } from '@deepseek-ai/dsh-api-usage-controller/types'
import { UsageSource, type QueryUsage } from '../src/client/source.ts'
import { deferred, report, request } from './fixtures.ts'

const sources: UsageSource[] = []
const release: (() => void)[] = []
afterEach(async () => {
  for (const resolve of release.splice(0)) resolve()
  await Promise.all(sources.splice(0).map(source => source.dispose()))
  vi.restoreAllMocks()
})
function source() { const value = new UsageSource(); sources.push(value); return value }
function delayed() {
  const value = deferred<UsageQueryResult>()
  release.push(() => { value.resolve(report()) })
  return value
}

describe('Usage query source', () => {
  it('remains unavailable without Remote, then loads an open page when Remote arrives', async () => {
    const value = source()
    const initial = value.getSnapshot()
    expect(value.getSnapshot()).toBe(initial)
    await value.load(request)
    expect(value.getSnapshot()).toEqual({ status: 'unavailable' })
    const query = vi.fn<QueryUsage>(async () => report())
    value.connect(query)
    await vi.waitFor(() => { expect(value.getSnapshot().status).toBe('ready') })
    expect(query.mock.calls[0]![0]).toEqual(request)
    expect(query.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal)
    await value.disconnect()
    expect(value.getSnapshot()).toEqual({ status: 'unavailable' })
  })

  it('aborts stale requests and ignores a late successful or failed settlement', async () => {
    const value = source()
    const old = delayed()
    const newer = delayed()
    const query = vi.fn<QueryUsage>().mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise)
    value.connect(query)
    const first = value.load(request)
    const nextRequest = { ...request, provider: 'deepseek' }
    const second = value.load(nextRequest)
    expect(query.mock.calls[0]![1].signal.aborted).toBe(true)
    const expected = report(nextRequest)
    newer.resolve(expected)
    await second
    old.reject(new Error('late error'))
    await first
    expect(value.getSnapshot()).toEqual({ status: 'ready', result: expected })
    const third = delayed()
    query.mockReturnValueOnce(third.promise)
    const thirdTask = value.load(request)
    value.cancel()
    third.resolve(report())
    await thirdTask
    expect(value.getSnapshot()).toEqual({ status: 'idle' })
  })

  it('clears exportable results during refresh and after failure, then supports retry', async () => {
    const value = source()
    const pending = delayed()
    const query = vi.fn<QueryUsage>().mockResolvedValueOnce(report()).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(report())
    value.connect(query)
    await value.load(request)
    const retry = value.load(request)
    expect(value.getSnapshot()).toEqual({ status: 'loading' })
    pending.reject(new Error('remote failure'))
    await retry
    expect(value.getSnapshot()).toEqual({ status: 'error' })
    await value.load(request)
    expect(value.getSnapshot().status).toBe('ready')
  })

  it('silences listeners before cancellation and waits for all requests to settle', async () => {
    const value = source()
    const pending = delayed()
    let signal: AbortSignal | undefined
    value.connect((_request, options) => { signal = options.signal; return pending.promise })
    const listener = vi.fn()
    const off = value.subscribe(listener)
    const task = value.load(request)
    let disposed = false
    const disposal = value.dispose().then(() => { disposed = true })
    expect(signal?.aborted).toBe(true)
    expect(disposed).toBe(false)
    const notices = listener.mock.calls.length
    pending.resolve(report())
    await Promise.all([task, disposal])
    expect(listener).toHaveBeenCalledTimes(notices)
    value.connect(async () => report())
    await value.load(request)
    value.subscribe(listener)()
    off()
    expect(listener).toHaveBeenCalledTimes(notices)
  })

  it('does not scan a closed page when its missing Remote later arrives', async () => {
    const value = source()
    await value.load(request)
    value.cancel()
    expect(value.getSnapshot()).toEqual({ status: 'unavailable' })
    const query = vi.fn<QueryUsage>(async () => report())
    value.connect(query)
    expect(value.getSnapshot()).toEqual({ status: 'idle' })
    expect(query).not.toHaveBeenCalled()
  })

  it('contains a throwing observer without starving later observers', async () => {
    const value = source()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    value.subscribe(() => { throw new Error('observer') })
    const listener = vi.fn()
    value.subscribe(listener)
    value.connect(async () => report())
    await value.load(request)
    expect(listener).toHaveBeenCalledTimes(3)
    expect(error).toHaveBeenCalled()
  })
})
