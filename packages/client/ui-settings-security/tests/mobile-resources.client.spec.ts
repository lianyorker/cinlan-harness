/** Observation owns polling and reads, never installation or mirroring commands. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileRuntimeStatus } from '@deepseek-ai/dsh-mobile-device-runtime/types'
import { createMobileResourceObserver } from '../src/client/mobile-resources.ts'
import { mobileStatus, mobileTask, mirrorId } from './mobile-runtime-fixture.ts'

const observers: ReturnType<typeof createMobileResourceObserver>[] = []
function observe(read: (signal: AbortSignal) => Promise<MobileRuntimeStatus>) {
  const observer = createMobileResourceObserver(read, 1000)
  observers.push(observer)
  return observer
}
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { for (const observer of observers.splice(0)) observer.dispose(); vi.useRealTimers() })

describe('Android resource observation ownership', () => {
  it.each(['task', 'mirror'] as const)('polls the active %s until terminal Host facts arrive', async (kind) => {
    const active = mobileStatus(kind === 'task' ? { task: mobileTask() }
      : { mirror: { id: mirrorId, deviceId: 'android:selected', state: 'running', error: null } })
    const read = vi.fn(async () => mobileStatus()).mockResolvedValueOnce(active)
    const observer = observe(read)
    const store = observer.store
    const off = observer.watch()
    const second = observer.watch()
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot()).toEqual({ status: 'ready', value: active })
    off()
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.getSnapshot()).toEqual({ status: 'ready', value: mobileStatus() })
    await vi.advanceTimersByTimeAsync(5000)
    expect(read).toHaveBeenCalledTimes(2)
    expect(observer.store).toBe(store)
    second(); second()
  })

  it('stops reads on navigation and ignores a delayed response from an older observation', async () => {
    const stale = Promise.withResolvers<MobileRuntimeStatus>()
    const signals: AbortSignal[] = []
    const read = vi.fn(async (signal: AbortSignal) => {
      signals.push(signal)
      return signals.length === 1 ? stale.promise : mobileStatus()
    })
    const observer = observe(read)
    const off = observer.watch()
    observer.refresh()
    await vi.advanceTimersByTimeAsync(0)
    expect(signals[0]?.aborted).toBe(true)
    const snapshot = observer.store.getSnapshot()
    stale.resolve(mobileStatus({ task: mobileTask() }))
    await vi.advanceTimersByTimeAsync(0)
    expect(observer.store.getSnapshot()).toBe(snapshot)
    off()
    await vi.advanceTimersByTimeAsync(5000)
    expect(read).toHaveBeenCalledTimes(2)
    expect(signals[1]?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('contains read failures and allows explicit refresh without retrying mutations', async () => {
    const read = vi.fn(async () => mobileStatus()).mockRejectedValueOnce(new Error('read failed'))
    const observer = observe(read)
    observer.refresh()
    expect(read).not.toHaveBeenCalled()
    const off = observer.watch()
    await vi.advanceTimersByTimeAsync(5000)
    expect(observer.store.getSnapshot()).toEqual({ status: 'error' })
    expect(read).toHaveBeenCalledOnce()
    observer.refresh()
    await vi.advanceTimersByTimeAsync(0)
    expect(observer.store.getSnapshot()).toEqual({ status: 'ready', value: mobileStatus() })
    off()
  })

  it('withdraws the scheduled poll when a synchronous listener leaves the page', async () => {
    const read = vi.fn(async () => mobileStatus({ task: mobileTask() }))
    const observer = observe(read)
    const off = observer.watch()
    const unsubscribe = observer.store.subscribe(off)
    await vi.advanceTimersByTimeAsync(5000)
    expect(read).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    unsubscribe()
  })

  it('does not issue a read if publication disposes the observer', () => {
    const read = vi.fn(async () => mobileStatus())
    const observer = observe(read)
    const unsubscribe = observer.store.subscribe(observer.dispose)
    observer.watch()(); observer.refresh()
    expect(read).not.toHaveBeenCalled()
    unsubscribe()
  })
})
