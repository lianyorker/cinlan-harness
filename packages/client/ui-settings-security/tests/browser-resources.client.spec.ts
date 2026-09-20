import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserRuntimeStatus } from '@deepseek-ai/dsh-browser-playwright/types'
import { createBrowserResourceObserver } from '../src/client/browser-resources.ts'
import { runtimeStatus, runtimeTask } from './browser-runtime-fixture.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { resolve, reject, promise }
}
const observers: ReturnType<typeof createBrowserResourceObserver>[] = []
function observe(read: (signal: AbortSignal) => Promise<BrowserRuntimeStatus>) {
  const observer = createBrowserResourceObserver(read, 1000)
  observers.push(observer)
  return observer
}
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  for (const observer of observers.splice(0)) observer.dispose()
  vi.useRealTimers()
})

describe('Browser runtime observation lifetime', () => {
  it('shares a snapshot source and polls active tasks until a terminal snapshot arrives', async () => {
    const active = runtimeStatus({ task: runtimeTask() })
    const complete = runtimeStatus({ installed: true, managedInstalled: true, task: runtimeTask({ state: 'succeeded', phase: 'complete' }) })
    const read = vi.fn(async () => active).mockResolvedValueOnce(active).mockResolvedValueOnce(complete)
    const observer = observe(read)
    const source = observer.store
    const off = observer.watch()
    const offSecond = observer.watch()
    await vi.advanceTimersByTimeAsync(0)
    expect(source.getSnapshot()).toEqual({ status: 'ready', value: active })
    expect(read).toHaveBeenCalledTimes(1)
    off()
    await vi.advanceTimersByTimeAsync(1000)
    expect(source.getSnapshot()).toEqual({ status: 'ready', value: complete })
    expect(observer.store).toBe(source)
    await vi.advanceTimersByTimeAsync(5000)
    expect(read).toHaveBeenCalledTimes(2)
    offSecond(); offSecond()
  })

  it('does not poll an idle runtime and starts again after explicit refresh or remount', async () => {
    const read = vi.fn(async () => runtimeStatus())
    const observer = observe(read)
    observer.refresh()
    expect(read).not.toHaveBeenCalled()
    const off = observer.watch()
    await vi.advanceTimersByTimeAsync(5000)
    expect(read).toHaveBeenCalledTimes(1)
    observer.refresh()
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(2)
    off()
    const offAgain = observer.watch()
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(3)
    offAgain()
  })

  it('stops pending timers on navigation without sending any runtime mutation', async () => {
    const read = vi.fn(async () => runtimeStatus({ task: runtimeTask() }))
    const observer = observe(read)
    const off = observer.watch()
    await vi.advanceTimersByTimeAsync(0)
    off()
    await vi.advanceTimersByTimeAsync(5000)
    expect(read).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores delayed responses from aborted reads after reconnect', async () => {
    const old = deferred<BrowserRuntimeStatus>()
    const signals: AbortSignal[] = []
    const read = vi.fn(async (signal: AbortSignal) => {
      signals.push(signal)
      return signals.length === 1 ? old.promise : runtimeStatus()
    })
    const observer = observe(read)
    const off = observer.watch()
    observer.refresh()
    await vi.advanceTimersByTimeAsync(0)
    expect(signals[0]!.aborted).toBe(true)
    const current = observer.store.getSnapshot()
    old.resolve(runtimeStatus({ task: runtimeTask() }))
    await vi.advanceTimersByTimeAsync(0)
    expect(observer.store.getSnapshot()).toBe(current)
    expect(vi.getTimerCount()).toBe(0)
    off()
  })

  it('contains a late rejected read after disposal and prevents new watches', async () => {
    const late = deferred<BrowserRuntimeStatus>()
    const read = vi.fn(async () => late.promise)
    const observer = observe(read)
    const off = observer.watch()
    observer.dispose()
    late.reject(new Error('late rejection'))
    await vi.advanceTimersByTimeAsync(0)
    expect(observer.store.getSnapshot()).toEqual({ status: 'loading' })
    observer.watch()(); observer.refresh(); off()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('stops polling when a synchronous snapshot listener leaves the page', async () => {
    const read = vi.fn(async () => runtimeStatus({ task: runtimeTask() }))
    const observer = observe(read)
    const off = observer.watch()
    const unsubscribe = observer.store.subscribe(() => { off() })
    await vi.advanceTimersByTimeAsync(5000)
    expect(read).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    unsubscribe()
  })

  it('does not issue a read when a loading listener disposes the observer', () => {
    const read = vi.fn(async () => runtimeStatus())
    const observer = observe(read)
    const unsubscribe = observer.store.subscribe(() => { observer.dispose() })
    observer.watch()()
    expect(read).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('reports failed observations and permits explicit recovery without polling errors', async () => {
    const read = vi.fn(async () => runtimeStatus()).mockRejectedValueOnce(new Error('disconnected'))
    const observer = observe(read)
    const off = observer.watch()
    await vi.advanceTimersByTimeAsync(5000)
    expect(observer.store.getSnapshot()).toEqual({ status: 'error' })
    expect(read).toHaveBeenCalledTimes(1)
    observer.refresh()
    await vi.advanceTimersByTimeAsync(0)
    expect(observer.store.getSnapshot()).toEqual({ status: 'ready', value: runtimeStatus() })
    off()
  })
})
