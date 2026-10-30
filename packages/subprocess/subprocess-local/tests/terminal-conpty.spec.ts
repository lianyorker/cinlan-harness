/** ConPTY asynchronous PID allocation, without host-native processes. */
import { afterEach, expect, it, vi } from 'vitest'
import type { IPty } from 'node-pty'
import { LocalTerminalHandle } from '../src/terminal.ts'
import { createWindowsProcessInspector } from '../src/windows-inspector.ts'

afterEach(() => { vi.useRealTimers() })

it('captures the asynchronously assigned ConPTY PID before cleanup', async () => {
  vi.useFakeTimers()
  const pty = { pid: 0, kill: vi.fn(), onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }) } as IPty
  let alive = true
  const taskkill = vi.fn(() => { alive = false })
  const inspector = createWindowsProcessInspector({
    snapshot: () => [{ pid: 123, parentPid: 1 }],
    processState: pid => pid === 123 ? { started: 'shell', active: alive } : undefined,
    taskkill,
  })
  const handle = new LocalTerminalHandle(pty, inspector, 100, 'win32')
  expect(handle.pid).toBe(0)
  const stopped = handle.terminate()
  await vi.advanceTimersByTimeAsync(10)
  Object.defineProperty(pty, 'pid', { value: 123 })
  await vi.advanceTimersByTimeAsync(250)
  await stopped
  expect(handle.pid).toBe(123)
  expect(taskkill).toHaveBeenCalledWith(123, false)
  expect(pty.kill).not.toHaveBeenCalled()
  expect(await handle.done).toEqual({ exitCode: null, signal: null })
})
