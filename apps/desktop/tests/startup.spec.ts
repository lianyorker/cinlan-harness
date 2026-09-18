import { describe, expect, it, vi } from 'vitest'
import { DesktopStartup, type DesktopStartupOperations, type DesktopStartupState } from '../src/startup.ts'

function barrier() {
  let resolve!: () => void
  const promise = new Promise<void>((complete) => { resolve = complete })
  return { promise, resolve }
}

function fixture(overrides: Partial<DesktopStartupOperations> = {}) {
  const states: DesktopStartupState[] = []
  const operations: DesktopStartupOperations = {
    show: vi.fn(async () => {}),
    prepare: vi.fn<DesktopStartupOperations['prepare']>(async (_signal, report) => { report('verifying') }),
    startHost: vi.fn(async () => {}),
    openApp: vi.fn(async () => {}),
    stopHosts: vi.fn(async () => {}),
    diagnose: vi.fn(async () => '/private-test/startup-error.log'),
    publish: (state) => { states.push(state) },
    ...overrides,
  }
  return { startup: new DesktopStartup(operations), operations, states }
}

describe('visible desktop startup', () => {
  it('waits for the visible page before preparation and reports real transitions', async () => {
    const painted = barrier()
    const prepared = barrier()
    const preparing = barrier()
    const { startup, operations, states } = fixture({
      show: () => painted.promise,
      prepare: async (_signal, report) => {
        report('verifying')
        report('installing')
        preparing.resolve()
        await prepared.promise
      },
    })
    const started = startup.start()
    expect(states).toEqual([])
    expect(operations.startHost).not.toHaveBeenCalled()
    painted.resolve()
    await preparing.promise
    expect(states).toEqual([
      { phase: 'starting', stage: 'verifying' },
      { phase: 'starting', stage: 'installing' },
    ])
    expect(operations.startHost).not.toHaveBeenCalled()
    prepared.resolve()
    await started
    expect(states.slice(2)).toEqual([
      { phase: 'starting', stage: 'starting-host' },
      { phase: 'starting', stage: 'loading-app' },
      { phase: 'ready' },
    ])
    expect(operations.openApp).toHaveBeenCalledOnce()
    await startup.close()
  })

  it.each(['prepare', 'startHost', 'openApp'] as const)('keeps %s failure visible with a diagnostic and safe restart', async (operation) => {
    const error = new Error('fixture startup failure')
    const { startup, operations } = fixture({ [operation]: async () => { throw error } })
    await startup.start()
    expect(operations.stopHosts).toHaveBeenCalledOnce()
    expect(operations.diagnose).toHaveBeenCalledWith(error)
    expect(startup.state).toEqual({
      phase: 'error', message: error.message, diagnosticFile: '/private-test/startup-error.log', canRestart: true,
    })
    if (operation !== 'openApp') expect(operations.openApp).not.toHaveBeenCalled()
    await startup.close()
  })

  it('waits for canceled preparation and ignores late stage reports', async () => {
    const preparing = barrier()
    const released = barrier()
    let canceled = false
    const { startup, operations, states } = fixture({
      prepare: async (signal, report) => {
        signal.addEventListener('abort', () => { canceled = true }, { once: true })
        preparing.resolve()
        await released.promise
        report('activating')
      },
    })
    const started = startup.start()
    await preparing.promise
    let closed = false
    const closing = startup.close().then(() => { closed = true })
    expect(canceled).toBe(true)
    expect(closed).toBe(false)
    expect(startup.state).toEqual({ phase: 'stopping' })
    released.resolve()
    await Promise.all([started, closing])
    expect(closed).toBe(true)
    expect(states).toEqual([{ phase: 'stopping' }])
    expect(operations.startHost).not.toHaveBeenCalled()
    expect(operations.openApp).not.toHaveBeenCalled()
  })

  it('stops a Host still awaiting readiness and waits for its quiescence', async () => {
    const starting = barrier()
    const hostClosed = barrier()
    const { startup, operations } = fixture({
      startHost: async () => {
        starting.resolve()
        await hostClosed.promise
        throw new Error('Host canceled')
      },
      stopHosts: vi.fn(() => hostClosed.promise),
    })
    const started = startup.start()
    await starting.promise
    const closing = startup.close()
    expect(startup.close()).toBe(closing)
    expect(operations.stopHosts).toHaveBeenCalledOnce()
    let settled = false
    void closing.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    hostClosed.resolve()
    await Promise.all([started, closing])
    expect(operations.openApp).not.toHaveBeenCalled()
    expect(operations.diagnose).not.toHaveBeenCalled()
  })

  it('does not prepare after closing before the first paint', async () => {
    const painted = barrier()
    const { startup, operations } = fixture({ show: () => painted.promise })
    const started = startup.start()
    const closing = startup.close()
    painted.resolve()
    await Promise.all([started, closing])
    expect(operations.prepare).not.toHaveBeenCalled()
    expect(operations.startHost).not.toHaveBeenCalled()
  })

  it('prevents restart if child cleanup fails and still records the failure', async () => {
    const { startup } = fixture({
      prepare: async () => { throw new Error('seed failed') },
      stopHosts: async () => { throw new Error('Host still active') },
      diagnose: async () => undefined,
    })
    await startup.start()
    expect(startup.state).toEqual({ phase: 'error', message: 'Desktop startup and Host cleanup failed', canRestart: false })
    await expect(startup.close()).rejects.toThrow('Desktop shutdown did not complete')
    expect(startup.state).toEqual({ phase: 'error', message: 'Desktop shutdown did not complete', canRestart: false })
  })
})
