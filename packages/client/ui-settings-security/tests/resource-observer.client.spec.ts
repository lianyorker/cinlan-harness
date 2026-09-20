import { describe, expect, it, vi } from 'vitest'
import type { SecurityResourceAvailability } from '@deepseek-ai/dsh-api-remotes/client'
import { createSecurityResourceObserver } from '../src/client/resource-observer.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { resolve, promise }
}
const empty: SecurityResourceAvailability = { resourceId: 'security-skills', state: 'not-installed', download: { available: false } }

describe('Security resource observation lifetime', () => {
  it('shares one observation, preserves source identity, and only unsubscribes on the last view leaving', async () => {
    let signal!: AbortSignal
    const next = deferred<SecurityResourceAvailability>()
    const reader = { observeResources: vi.fn(async function* (observationSignal?: AbortSignal) {
      signal = observationSignal!
      yield empty
      yield await next.promise
    }) }
    const observer = createSecurityResourceObserver(reader)
    const source = observer.store
    const releaseFirst = observer.watch()
    const releaseSecond = observer.watch()
    await vi.waitFor(() => { expect(source.getSnapshot()).toEqual({ status: 'ready', value: empty }) })
    expect(observer.store).toBe(source)
    expect(reader.observeResources).toHaveBeenCalledOnce()
    const before = source.getSnapshot()
    releaseFirst()
    expect(signal.aborted).toBe(false)
    releaseSecond()
    releaseSecond()
    expect(signal.aborted).toBe(true)
    next.resolve({ state: 'unavailable', reason: 'component-missing' })
    await next.promise
    await Promise.resolve()
    expect(source.getSnapshot()).toBe(before)
    observer.dispose()
  })

  it('rejects a late frame from a disconnected generation and observes again after navigation', async () => {
    const late = deferred<SecurityResourceAvailability>()
    const close = deferred<undefined>()
    const signals: AbortSignal[] = []
    const reader = { observeResources: vi.fn(async function* (signal?: AbortSignal) {
      signals.push(signal!)
      if (signals.length === 1) yield await late.promise
      else { yield empty; await close.promise }
    }) }
    const observer = createSecurityResourceObserver(reader)
    const off = observer.watch()
    observer.refresh()
    await vi.waitFor(() => { expect(observer.store.getSnapshot()).toEqual({ status: 'ready', value: empty }) })
    expect(signals[0]!.aborted).toBe(true)
    late.resolve({ state: 'unavailable', reason: 'component-missing' })
    await late.promise
    await Promise.resolve()
    expect(observer.store.getSnapshot()).toEqual({ status: 'ready', value: empty })
    off()
    const offAgain = observer.watch()
    expect(reader.observeResources).toHaveBeenCalledTimes(3)
    observer.dispose()
    expect(signals[2]!.aborted).toBe(true)
    offAgain()
    close.resolve(undefined)
  })

  it('reports a failed stream and recovers through explicit refresh', async () => {
    let attempts = 0
    const close = deferred<undefined>()
    const observer = createSecurityResourceObserver({ observeResources: async function* () {
      attempts += 1
      if (attempts === 1) throw new Error('disconnected')
      yield empty
      await close.promise
    } })
    const off = observer.watch()
    await vi.waitFor(() => { expect(observer.store.getSnapshot()).toEqual({ status: 'error' }) })
    observer.refresh()
    await vi.waitFor(() => { expect(observer.store.getSnapshot()).toEqual({ status: 'ready', value: empty }) })
    off()
    close.resolve(undefined)
    observer.dispose()
  })
})
