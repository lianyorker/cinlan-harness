import { describe, expect, it, vi } from 'vitest'
import { checkDesktopStartupHost } from '../src/startup-probe.ts'

function barrier() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('staged startup Host ownership', () => {
  it('paces a failed stop retry and joins it through cancellation before rejecting the check', async () => {
    const closed = barrier()
    const stop = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('stop timed out'))
      .mockImplementation(() => closed.promise)
    const report = vi.fn()
    const signal = new AbortController()
    vi.useFakeTimers()
    const check = checkDesktopStartupHost({
      start: async () => ({ protocolVersion: 4, dshVersion: 'fixture' }), stop,
    }, signal.signal, report)
    let settled = false
    const completion = check.then(() => { settled = true }, () => { settled = true })
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(report).toHaveBeenCalledOnce()
      expect(stop).toHaveBeenCalledOnce()
      signal.abort(new Error('startup closing'))
      await vi.advanceTimersByTimeAsync(249)
      expect(stop).toHaveBeenCalledOnce()
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(stop).toHaveBeenCalledTimes(2)
      expect(settled).toBe(false)
      const rejection = expect(check).rejects.toThrow('startup closing')
      closed.resolve()
      await rejection
      expect(stop).toHaveBeenCalledTimes(2)
    } finally {
      closed.resolve()
      await vi.runOnlyPendingTimersAsync()
      await completion
      vi.useRealTimers()
    }
  })
})
