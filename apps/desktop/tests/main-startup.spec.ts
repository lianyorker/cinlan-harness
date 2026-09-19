import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDesktopPaths } from '../src/paths.ts'
import { DESKTOP_IPC } from '../src/ipc.ts'
import type { DesktopProjectManager } from '../src/project-manager.ts'

function barrier<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of cleanup.splice(0)) await dispose()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function boot(options: {
  holdPaint?: boolean
  failPreparation?: boolean
  holdHost?: boolean
  holdCleanup?: boolean
  failCleanup?: boolean
} = {}) {
  vi.resetModules()
  vi.stubEnv('DSH_DESKTOP_DEV_PROJECT_DIR', '')
  const root = mkdtempSync(join(tmpdir(), 'dsh-main-startup-'))
  vi.stubEnv('DSH_DESKTOP_NODE_BINARY', process.execPath)
  vi.stubEnv('DSH_DESKTOP_PNPM_ENTRY', join(root, 'pnpm.mjs'))
  vi.stubEnv('DSH_DESKTOP_SEED_DIR', join(root, 'seed'))
  const prepared = barrier()
  const preparation = barrier()
  const painted = barrier()
  const paintRequested = barrier()
  const hostStarting = barrier()
  const hostReady = barrier()
  const appLoaded = barrier()
  const cleanupStarted = barrier()
  const cleanupFinished = barrier()
  const failed = barrier()
  const quit = barrier()
  const calls: string[] = []
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const windows: Window[] = []
  const app = Object.assign(new EventEmitter(), {
    isPackaged: false, name: 'fixture',
    getLocale: () => 'zh-CN', getVersion: () => '1.0.0',
    getAppPath: () => root,
    requestSingleInstanceLock: () => true,
    whenReady: async () => {},
    relaunch: vi.fn(),
    exit: vi.fn(),
    quit: vi.fn(() => {
      let prevented = false
      app.emit('before-quit', { preventDefault: () => { prevented = true } })
      if (!prevented) {
        calls.push('quit')
        for (const window of windows) window.destroy()
        quit.resolve()
      }
    }),
  })
  class Window extends EventEmitter {
    destroyed = false
    visible = false
    url = ''
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: { url: '' },
      setWindowOpenHandler: vi.fn(),
      send: vi.fn((channel: string, state: { phase: string }) => {
        if (channel === DESKTOP_IPC.startupState && state.phase === 'error') failed.resolve()
      }),
      getURL: () => this.url,
      executeJavaScript: vi.fn(() => {
        calls.push('paint')
        paintRequested.resolve()
        return options.holdPaint ? painted.promise : Promise.resolve()
      }),
      openDevTools: vi.fn(), reload: vi.fn(),
    })
    constructor() { super(); windows.push(this); calls.push('window') }
    static getAllWindows() { return windows.filter(window => !window.destroyed) }
    isDestroyed() { return this.destroyed }
    isMinimized() { return false }
    show() { this.visible = true; calls.push('show') }
    focus() {}
    restore() {}
    setSize() {}
    setTitle() {}
    destroy() { if (this.destroyed) return; this.destroyed = true; this.emit('closed') }
    close() {
      let prevented = false
      this.emit('close', { preventDefault: () => { prevented = true } })
      if (!prevented) this.destroy()
    }
    async loadURL(url: string) {
      this.url = url
      this.webContents.mainFrame.url = url
      calls.push(url)
      if (url === 'dsh-app://app/index.html') appLoaded.resolve()
    }
  }
  const stop = vi.fn(async () => {
    calls.push('host-stopped')
    if (options.holdHost) hostReady.reject(new Error('Host stopped before ready'))
  })
  const prepare = vi.fn(async (_request: unknown, signal: AbortSignal, report: (stage: string) => void) => {
    calls.push('prepare')
    report('verifying')
    prepared.resolve()
    await preparation.promise
    signal.throwIfAborted()
    if (options.failPreparation) throw new Error('fixture integrity failure')
  })
  vi.doMock('electron', () => ({
    app, BrowserWindow: Window,
    ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) } },
    protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
    dialog: { showErrorBox: vi.fn(), showMessageBox: vi.fn() },
    Menu: { buildFromTemplate: vi.fn((value: unknown) => value), setApplicationMenu: vi.fn() },
  }))
  vi.doMock('../src/paths.ts', () => ({ resolveDesktopPaths: () => resolveDesktopPaths(root) }))
  const maintenance = vi.fn(async (signal: AbortSignal) => {
    cleanupStarted.resolve()
    if (options.holdCleanup) await cleanupFinished.promise
    signal.throwIfAborted()
    if (options.failCleanup) throw new Error('fixture staging EPERM')
  })
  const mutate = vi.fn<DesktopProjectManager['mutate']>(async () => {})
  vi.doMock('../src/project-manager.ts', () => ({ DesktopProjectManager: class {
    cleanupOrphanedStaging = maintenance
    mutate = mutate
  } }))
  vi.doMock('../src/startup-preparation.ts', () => ({ prepareDesktopProfile: prepare }))
  vi.doMock('../src/host-process.ts', () => ({ DesktopHostProcess: class {
    start() {
      calls.push('host-start')
      hostStarting.resolve()
      return options.holdHost ? hostReady.promise : Promise.resolve()
    }
    stop = stop
  } }))
  vi.doMock('../src/update-coordinator.ts', () => ({ DesktopUpdateCoordinator: vi.fn(function () {}) }))
  vi.doMock('../src/floating-window.ts', () => ({ installFloatingWindowPolicy: () => ({ close() {}, dispose() {} }) }))
  vi.doMock('../src/startup-diagnostic.ts', () => ({ writeStartupDiagnostic: async () => join(root, 'startup-error.log') }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  cleanup.push(async () => {
    cleanupFinished.resolve()
    preparation.resolve()
    painted.resolve()
    if (calls.includes('host-start')) hostReady.resolve()
    app.quit()
    await quit.promise
    rmSync(root, { recursive: true, force: true })
  })
  await import('../src/main.ts')
  return {
    root, windows, calls, app, prepare, stop, prepared, preparation, paintRequested, hostStarting, appLoaded, failed, quit, handlers,
    maintenance, mutate, cleanupStarted, cleanupFinished,
  }
}

describe('Electron startup entry', () => {
  it('loads, shows, and paints the local page before reconciliation or Host creation', async () => {
    const run = await boot()
    await run.prepared.promise
    expect(run.calls).toEqual(['window', 'dsh-app://shell/startup.html', 'show', 'paint', 'prepare'])
    expect(run.windows[0]?.visible).toBe(true)
    run.preparation.resolve()
    await run.appLoaded.promise
    expect(run.calls.indexOf('host-start')).toBeGreaterThan(run.calls.indexOf('prepare'))
    expect(run.calls.at(-1)).toBe('dsh-app://app/index.html')
  })

  it('loads the application before orphan cleanup and joins in-flight cleanup before quitting', async () => {
    const run = await boot({ holdCleanup: true })
    await run.prepared.promise
    expect(run.maintenance).not.toHaveBeenCalled()
    run.preparation.resolve()
    await run.cleanupStarted.promise
    expect(run.windows[0]?.url).toBe('dsh-app://app/index.html')
    expect(run.windows[0]?.visible).toBe(true)
    await expect(`${JSON.stringify({
      document: run.windows[0]!.url,
      visible: run.windows[0]!.visible,
      states: run.windows[0]!.webContents.send.mock.calls
        .filter(([channel]) => channel === DESKTOP_IPC.startupState).map(([, state]) => state),
    }, null, 2)}\n`).toMatchFileSnapshot('./expected/startup-deferred-cleanup.json')
    const signal = run.maintenance.mock.calls[0]![0]
    run.windows[0]!.close()
    expect(signal.aborted).toBe(true)
    expect(run.calls).not.toContain('quit')
    run.cleanupFinished.resolve()
    await run.quit.promise
    expect(run.calls.at(-1)).toBe('quit')
  })

  it('serializes plugin mutations after asynchronous orphan cleanup', async () => {
    const run = await boot({ holdCleanup: true })
    await run.prepared.promise
    run.preparation.resolve()
    await run.cleanupStarted.promise
    const mutation = run.handlers.get(DESKTOP_IPC.pluginsAdd)!({
      senderFrame: { url: 'dsh-app://shell/plugin-manager.html' },
    }, '@fixture/plugin')
    expect(run.mutate).not.toHaveBeenCalled()
    run.cleanupFinished.resolve()
    await mutation
    expect(run.mutate).toHaveBeenCalledOnce()
    expect(run.maintenance).toHaveBeenCalledTimes(2)
  })

  it('retains failed Hosts and stops them before a later mutation can recover profiles', async () => {
    const run = await boot()
    await run.prepared.promise
    run.preparation.resolve()
    await run.cleanupStarted.promise
    const normalStop = run.stop.getMockImplementation()!
    const event = { senderFrame: { url: 'dsh-app://shell/plugin-manager.html' } }
    const add = run.handlers.get(DESKTOP_IPC.pluginsAdd)!
    run.mutate.mockImplementationOnce(async (_mutation, hooks) => { await hooks.beforeActivate() })
    run.stop.mockRejectedValue(new Error('Host still holds files'))
    try {
      await expect(add(event, '@fixture/plugin')).rejects.toThrow('Desktop Host cleanup failed')
      expect(run.mutate).toHaveBeenCalledOnce()
      expect(run.maintenance).toHaveBeenCalledOnce()
      await expect(add(event, '@fixture/plugin')).rejects.toThrow('Desktop Host cleanup failed')
      expect(run.mutate).toHaveBeenCalledOnce()
      expect(run.maintenance).toHaveBeenCalledOnce()
    } finally {
      run.stop.mockImplementation(normalStop)
    }
    await add(event, '@fixture/plugin')
    expect(run.mutate).toHaveBeenCalledTimes(2)
    expect(run.maintenance).toHaveBeenCalledTimes(2)
  })

  it('keeps the ready application usable when staging maintenance fails', async () => {
    const run = await boot({ failCleanup: true })
    await run.prepared.promise
    run.preparation.resolve()
    await run.cleanupStarted.promise
    await expect.poll(() => vi.mocked(console.warn).mock.calls.length).toBe(1)
    expect(run.windows[0]?.url).toBe('dsh-app://app/index.html')
    expect(run.app.exit).not.toHaveBeenCalled()
    expect(run.windows[0]?.webContents.send).not.toHaveBeenCalledWith(
      DESKTOP_IPC.startupState, expect.objectContaining({ phase: 'error' }),
    )
  })

  it('keeps a preparation failure on the visible page with diagnostic actions', async () => {
    const run = await boot({ failPreparation: true })
    await run.prepared.promise
    run.preparation.resolve()
    await run.failed.promise
    const window = run.windows[0]!
    const state = run.handlers.get(DESKTOP_IPC.startupGet)!({ sender: window.webContents, senderFrame: window.webContents.mainFrame })
    expect(state).toMatchObject({ state: { phase: 'error', canRestart: true, diagnosticFile: join(run.root, 'startup-error.log') } })
    expect(window.visible).toBe(true)
    expect(window.url).toBe('dsh-app://shell/startup.html')
    expect(run.calls).not.toContain('host-start')
    expect(run.app.exit).not.toHaveBeenCalled()
  })

  it('holds close until preparation finishes, then exits without starting a Host', async () => {
    const run = await boot()
    await run.prepared.promise
    run.windows[0]!.close()
    expect(run.windows[0]!.destroyed).toBe(false)
    expect(run.calls).not.toContain('quit')
    run.preparation.resolve()
    await run.quit.promise
    expect(run.calls).not.toContain('host-start')
    expect(run.calls.at(-1)).toBe('quit')
  })

  it('cancels a suspended first paint when closing a minimized startup window', async () => {
    const run = await boot({ holdPaint: true })
    await run.paintRequested.promise
    run.windows[0]!.close()
    await run.quit.promise
    expect(run.prepare).not.toHaveBeenCalled()
    expect(run.calls).not.toContain('host-start')
  })

  it('owns and stops a Host before readiness when the startup window closes', async () => {
    const run = await boot({ holdHost: true })
    await run.prepared.promise
    run.preparation.resolve()
    await run.hostStarting.promise
    run.windows[0]!.close()
    await run.quit.promise
    expect(run.stop).toHaveBeenCalled()
    expect(run.calls).not.toContain('dsh-app://app/index.html')
    expect(run.calls.indexOf('host-stopped')).toBeLessThan(run.calls.indexOf('quit'))
  })
})
