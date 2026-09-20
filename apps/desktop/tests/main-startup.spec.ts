import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDesktopPaths } from '../src/paths.ts'
import { DESKTOP_IPC } from '../src/ipc.ts'
import type { DesktopProjectManager } from '../src/project-manager.ts'
import type { DesktopUpdateRuntimeOptions } from '../src/update-runtime.ts'
import type { DesktopUpdateState } from '../src/ipc.ts'

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
  activeTasks?: boolean
  lockActiveTasks?: boolean
  holdConfirmation?: boolean
  stopFailure?: 'unclean' | 'unconfirmed'
  failReplacement?: boolean
} = {}) {
  vi.resetModules()
  vi.stubEnv('DSH_DESKTOP_DEV_PROJECT_DIR', '')
  const root = mkdtempSync(join(tmpdir(), 'dsh-main-startup-'))
  vi.stubEnv('DSH_DESKTOP_NODE_BINARY', process.execPath)
  vi.stubEnv('DSH_DESKTOP_PNPM_ENTRY', join(root, 'pnpm.mjs'))
  vi.stubEnv('DSH_DESKTOP_SEED_DIR', join(root, 'seed'))
  vi.stubEnv('DSH_DESKTOP_PRIMARY_RUNTIME', join(root, 'runtime', 'primary-runtime'))
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
  const confirmation = barrier<boolean>()
  let updateOptions!: DesktopUpdateRuntimeOptions
  let updateState: DesktopUpdateState = { phase: 'ready', version: '2.0.0' }
  const confirmUpdate = vi.fn(async (_version: string, _active: boolean) => options.holdConfirmation ? confirmation.promise : true)
  const powerMonitor = new EventEmitter()
  class UncleanExit extends Error {}
  let stopFailed = false
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
    focus = vi.fn()
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
  const hosts: Host[] = []
  const hostCounts: number[] = []
  const start = vi.fn(async () => {
    calls.push('host-start')
    hostStarting.resolve()
    if (options.holdHost) await hostReady.promise
  })
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
    app, BrowserWindow: Window, powerMonitor,
    ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => { handlers.set(channel, handler) } },
    protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
    dialog: { showErrorBox: vi.fn(), showMessageBox: vi.fn(async () => ({ response: 0, checkboxChecked: false })) },
    Menu: { buildFromTemplate: vi.fn((value: unknown) => value), setApplicationMenu: vi.fn() },
  }))
  vi.doMock('../src/paths.ts', () => ({ resolveDesktopPaths: () => resolveDesktopPaths(root) }))
  const maintenance = vi.fn(async (signal: AbortSignal) => {
    cleanupStarted.resolve()
    if (options.holdCleanup) await cleanupFinished.promise
    signal.throwIfAborted()
    if (options.failCleanup) throw new Error('fixture staging EPERM')
  })
  const mutate = vi.fn<DesktopProjectManager['mutate']>(async (_mutation, hooks) => {
    await hooks.healthCheck(join(root, 'staged-profile'))
    await hooks.beforeActivate()
    await hooks.afterActivate()
  })
  vi.doMock('../src/project-manager.ts', () => ({ DesktopProjectManager: class {
    cleanupOrphanedStaging = maintenance
    mutate = mutate
    disableThirdPartyPlugins = vi.fn(async () => {})
  } }))
  vi.doMock('../src/startup-preparation.ts', () => ({ prepareDesktopProfile: prepare }))
  class Host {
    running = false
    constructor(_node: string, readonly projectDir: string, _inspectPort?: number, _allowLinkedProfile?: boolean,
      _onFailure?: (error: Error) => void, readonly primaryRuntime?: string) { hosts.push(this) }
    async start() {
      this.running = true
      hostCounts.push(hosts.filter(host => host.running).length)
      await start()
      if (options.failReplacement && hosts.length > 1) throw new Error('replacement failed')
    }
    async updateTasks(action: 'inspect' | 'lock' | 'unlock') {
      calls.push('tasks-' + action)
      return action === 'inspect' ? options.activeTasks === true : action === 'lock' && options.lockActiveTasks === true
    }
    async stop(strict = false) {
      await stop()
      if (strict && options.stopFailure !== undefined && !stopFailed) {
        stopFailed = true
        if (options.stopFailure === 'unconfirmed') throw new Error('exit was not confirmed')
        this.running = false
        throw new UncleanExit('unclean exit')
      }
      this.running = false
    }
  }
  vi.doMock('../src/host-process.ts', () => ({ DesktopHostProcess: Host, DesktopHostUncleanExitError: UncleanExit }))
  vi.doMock('../src/update-runtime.ts', () => ({ DesktopUpdateRuntime: class {
    constructor(value: DesktopUpdateRuntimeOptions) { updateOptions = value }
    get state() { return updateState }
    blocking = false
    start = async () => {}
    dispose = async () => {}
    open = async () => {}
    confirm = confirmUpdate
    automaticCheck = () => {}
    preparingRestart = () => {}
    record = () => {}
    focus = () => {}
  } }))
  vi.doMock('../src/floating-window.ts', () => ({ installFloatingWindowPolicy: () => ({ close() {}, dispose() {} }) }))
  vi.doMock('../src/startup-diagnostic.ts', () => ({ writeStartupDiagnostic: async () => join(root, 'startup-error.log') }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  cleanup.push(async () => {
    confirmation.resolve(false)
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
    maintenance, mutate, cleanupStarted, cleanupFinished, start, hosts, hostCounts, confirmUpdate, confirmation,
    prepareUpdate: () => updateOptions.beforeRestart(),
    publishUpdate: (state: DesktopUpdateState) => { updateState = state; updateOptions.publish(state) },
  }
}

function pluginSender(run: Awaited<ReturnType<typeof boot>>) {
  const primary = run.windows[0]!
  run.handlers.get(DESKTOP_IPC.openPluginsWindow)!({ sender: primary.webContents, senderFrame: primary.webContents.mainFrame })
  const plugins = run.windows.find(window => !window.destroyed && window.url === 'dsh-app://shell/plugin-manager.html')!
  return { sender: plugins.webContents, senderFrame: plugins.webContents.mainFrame }
}

describe('native update installation in the main entry', () => {
  async function ready(options: Parameters<typeof boot>[0] = {}) {
    const run = await boot(options)
    await run.prepared.promise
    run.preparation.resolve()
    await run.cleanupStarted.promise
    return run
  }

  it('passes the same Office payload to startup preparation and every replacement Host', async () => {
    const run = await ready()
    const primaryRuntime = join(run.root, 'runtime', 'primary-runtime')
    expect(run.prepare.mock.calls[0]?.[0]).toMatchObject({ primaryRuntime, runtime: { primaryRuntime } })
    const event = pluginSender(run)
    await run.handlers.get(DESKTOP_IPC.pluginsAdd)!(event, '@fixture/plugin')
    expect(run.hosts).toHaveLength(3)
    expect(run.hosts.map(host => host.primaryRuntime)).toEqual([primaryRuntime, primaryRuntime, primaryRuntime])
  })

  it('keeps the Host available when the installation confirmation is cancelled', async () => {
    const run = await ready({ holdConfirmation: true, activeTasks: true })
    const preparation = run.prepareUpdate()
    await vi.waitFor(() => { expect(run.confirmUpdate).toHaveBeenCalledWith('2.0.0', true) })
    expect(run.stop).not.toHaveBeenCalled()
    run.confirmation.resolve(false)
    await expect(preparation).resolves.toBe(false)
    expect(run.calls).toContain('tasks-inspect')
    expect(run.calls).not.toContain('tasks-lock')
    expect(run.hosts[0]!.running).toBe(true)
  })

  it('refuses installation and unlocks when work starts after inspection', async () => {
    const run = await ready({ lockActiveTasks: true })
    await expect(run.prepareUpdate()).rejects.toMatchObject({ kind: 'tasks-changed' })
    expect(run.calls.slice(-3)).toEqual(['tasks-inspect', 'tasks-lock', 'tasks-unlock'])
    expect(run.stop).not.toHaveBeenCalled()
    expect(run.hosts[0]!.running).toBe(true)
  })

  it('excludes plugin mutation while task consent is pending', async () => {
    const run = await ready({ holdConfirmation: true })
    const event = pluginSender(run)
    const preparation = run.prepareUpdate()
    await vi.waitFor(() => { expect(run.confirmUpdate).toHaveBeenCalledOnce() })
    await expect(run.handlers.get(DESKTOP_IPC.pluginsAdd)!(event, '@fixture/plugin')).rejects.toThrow('updates prevent')
    expect(run.mutate).not.toHaveBeenCalled()
    run.confirmation.resolve(false)
    await preparation
  })

  it('waits for staging cleanup before locking and stopping the active Host', async () => {
    const run = await ready({ holdCleanup: true, activeTasks: true, lockActiveTasks: true })
    const preparation = run.prepareUpdate()
    await Promise.resolve()
    expect(run.calls).not.toContain('tasks-inspect')
    run.cleanupFinished.resolve()
    await expect(preparation).resolves.toBe(true)
    expect(run.calls.indexOf('tasks-inspect')).toBeLessThan(run.calls.indexOf('tasks-lock'))
    expect(run.calls.indexOf('tasks-lock')).toBeLessThan(run.calls.indexOf('host-stopped'))
    expect(run.hosts[0]!.running).toBe(false)
  })

  it.each([undefined, 'unclean'] as const)('restores one native Host after failed installation with confirmed exit: %s', async (stopFailure) => {
    const run = await ready(stopFailure === undefined ? {} : { stopFailure })
    if (stopFailure === undefined) await expect(run.prepareUpdate()).resolves.toBe(true)
    else await expect(run.prepareUpdate()).rejects.toMatchObject({ kind: 'stop-failed' })
    expect(run.hosts[0]!.running).toBe(false)
    run.publishUpdate({ phase: 'error', version: '2.0.0', failedOperation: 'install', message: 'installer failed' })
    await vi.waitFor(() => { expect(run.start).toHaveBeenCalledTimes(2) })
    expect(run.hostCounts).toEqual([1, 1])
    expect(run.hosts.filter(host => host.running)).toEqual([run.hosts[1]])
    await expect(run.prepareUpdate()).resolves.toBe(true)
  })

  it('retains an unconfirmed Host and refuses another install or package mutation', async () => {
    const run = await ready({ stopFailure: 'unconfirmed' })
    const event = pluginSender(run)
    await expect(run.prepareUpdate()).rejects.toMatchObject({ kind: 'stop-failed' })
    run.publishUpdate({ phase: 'error', version: '2.0.0', failedOperation: 'install' })
    expect(run.start).toHaveBeenCalledOnce()
    expect(run.hosts[0]!.running).toBe(true)
    await expect(run.prepareUpdate()).rejects.toThrow('exit was not confirmed')
    await expect(run.handlers.get(DESKTOP_IPC.pluginsAdd)!(event, '@fixture/plugin')).rejects.toThrow('updates prevent')
  })

  it('does not install or restart after quit cancels pending task consent', async () => {
    const run = await ready({ holdConfirmation: true })
    const preparation = run.prepareUpdate()
    await vi.waitFor(() => { expect(run.confirmUpdate).toHaveBeenCalledOnce() })
    run.app.quit()
    run.confirmation.resolve(true)
    await expect(preparation).resolves.toBe(false)
    await run.quit.promise
    expect(run.calls).not.toContain('tasks-lock')
    expect(run.start).toHaveBeenCalledOnce()
  })

  it('rejects update requests from a same-origin frame outside the owned window', async () => {
    const run = await ready()
    const other = { mainFrame: { url: 'dsh-app://app/index.html' } }
    await expect(run.handlers.get(DESKTOP_IPC.updatesOpen)!({ sender: other, senderFrame: other.mainFrame })).rejects.toThrow('owned application document')
  })
})

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
    const mutation = run.handlers.get(DESKTOP_IPC.pluginsAdd)!(pluginSender(run), '@fixture/plugin')
    expect(run.mutate).not.toHaveBeenCalled()
    run.cleanupFinished.resolve()
    await mutation
    expect(run.mutate).toHaveBeenCalledOnce()
    expect(run.maintenance).toHaveBeenCalledTimes(2)
  })

  it('opens and reuses the native Plugins window for the app renderer', async () => {
    const run = await boot()
    await run.prepared.promise
    run.preparation.resolve()
    await run.cleanupStarted.promise
    const open = run.handlers.get(DESKTOP_IPC.openPluginsWindow)!
    const event = { senderFrame: { url: 'dsh-app://app/index.html' } }
    expect(open(event)).toBeUndefined()
    expect(run.windows).toHaveLength(2)
    const plugins = run.windows[1]!
    expect(plugins.url).toBe('dsh-app://shell/plugin-manager.html')
    expect(open(event)).toBeUndefined()
    expect(run.windows).toHaveLength(2)
    expect(plugins.focus).toHaveBeenCalledOnce()
    expect(run.mutate).not.toHaveBeenCalled()
    expect(() => run.handlers.get(DESKTOP_IPC.pluginsList)!(event)).toThrow('unowned renderer')
    for (const [channel, args] of [
      [DESKTOP_IPC.pluginsAdd, ['@fixture/plugin']],
      [DESKTOP_IPC.pluginsRemove, ['@fixture/plugin']],
      [DESKTOP_IPC.pluginsUpdate, ['@fixture/plugin', '1.0.0']],
    ] as const) {
      await expect(run.handlers.get(channel)!(event, ...args)).rejects.toThrow('unowned renderer')
    }
    expect(run.mutate).not.toHaveBeenCalled()
    plugins.destroy()
    open(event)
    expect(run.windows).toHaveLength(3)
    expect(run.windows[2]!.url).toBe('dsh-app://shell/plugin-manager.html')
  })

  it.each([
    'dsh-app://shell/plugin-manager.html',
    'http://app/index.html',
    'dsh-app://unowned/index.html',
    'dsh-app://app:1234/index.html',
  ])('rejects a Plugins window request from %s', async (url) => {
    const run = await boot()
    await run.prepared.promise
    run.preparation.resolve()
    await run.cleanupStarted.promise
    expect(() => run.handlers.get(DESKTOP_IPC.openPluginsWindow)!({ senderFrame: { url } })).toThrow('rejected')
    expect(run.windows).toHaveLength(1)
    expect(run.mutate).not.toHaveBeenCalled()
  })

  it('waits for the active Host to flush saved patches before taking the mutation snapshot', async () => {
    const run = await boot()
    await run.prepared.promise
    run.preparation.resolve()
    await run.cleanupStarted.promise
    const profile = resolveDesktopPaths(run.root).profile
    mkdirSync(profile, { recursive: true })
    const patchPath = join(profile, 'cordis.patch.yml')
    writeFileSync(patchPath, '[]\n')
    const saved = '# Last live edit\n- id: saved-row\n  disabled: true\n'
    const stopStarted = barrier()
    const finishStop = barrier()
    run.stop.mockImplementationOnce(async () => {
      stopStarted.resolve()
      await finishStop.promise
      writeFileSync(patchPath, saved)
    })
    const snapshots: string[] = []
    const normalMutation = run.mutate.getMockImplementation()!
    run.mutate.mockImplementationOnce(async (mutation, hooks) => {
      snapshots.push(readFileSync(patchPath, 'utf8'))
      await normalMutation(mutation, hooks)
    })
    const pending = Promise.resolve(run.handlers.get(DESKTOP_IPC.pluginsAdd)!(pluginSender(run), '@fixture/plugin'))
    try {
      await Promise.race([stopStarted.promise, pending])
      expect(run.mutate).not.toHaveBeenCalled()
      expect(run.hosts.filter(host => host.running)).toHaveLength(1)
    } finally {
      finishStop.resolve()
      await pending
    }
    expect(snapshots).toEqual([saved])
    expect(run.hosts.map(host => host.projectDir)).toEqual([profile, join(run.root, 'staged-profile'), profile])
    expect(run.hosts.filter(host => host.running)).toEqual([run.hosts[2]])
    expect(run.hostCounts).toEqual([1, 1, 1])
    expect(run.windows[0]!.webContents.reload).toHaveBeenCalledOnce()
  })

  it.each(['install', 'health'] as const)('restarts the active Host once after a pre-activation %s failure', async (failure) => {
    const run = await boot()
    await run.prepared.promise
    run.preparation.resolve()
    await run.cleanupStarted.promise
    const error = new Error('fixture ' + failure + ' failure')
    if (failure === 'install') run.mutate.mockRejectedValueOnce(error)
    else run.start.mockRejectedValueOnce(error)
    await expect(run.handlers.get(DESKTOP_IPC.pluginsAdd)!(pluginSender(run), '@fixture/plugin')).rejects.toBe(error)
    expect(run.hosts.filter(host => host.running)).toEqual([run.hosts.at(-1)])
    expect(run.hosts.at(-1)!.projectDir).toBe(resolveDesktopPaths(run.root).profile)
    expect(run.start).toHaveBeenCalledTimes(failure === 'install' ? 2 : 3)
    expect(run.hostCounts.every(count => count === 1)).toBe(true)
  })

  it('keeps an unquiesced staging Host owned and blocks another mutation until it stops', async () => {
    const run = await boot()
    await run.prepared.promise
    run.preparation.resolve()
    await run.cleanupStarted.promise
    const stopFailure = new Error('fixture staging Host still running')
    const normalStop = run.stop.getMockImplementation()!
    run.stop.mockResolvedValueOnce(undefined).mockRejectedValue(stopFailure)
    const add = run.handlers.get(DESKTOP_IPC.pluginsAdd)!
    const event = pluginSender(run)
    try {
      await expect(add(event, '@fixture/plugin')).rejects.toThrow('staged health check and Host cleanup failed')
      expect(run.start).toHaveBeenCalledTimes(2)
      expect(run.hosts.filter(host => host.running)).toEqual([run.hosts[1]])
      await expect(add(event, '@fixture/plugin')).rejects.toThrow('Desktop Host cleanup failed')
      expect(run.mutate).toHaveBeenCalledOnce()
      expect(run.maintenance).toHaveBeenCalledOnce()
    } finally {
      run.stop.mockImplementation(normalStop)
    }
    await add(event, '@fixture/plugin')
    expect(run.mutate).toHaveBeenCalledTimes(2)
    expect(run.hosts.filter(host => host.running)).toEqual([run.hosts.at(-1)])
    expect(run.hostCounts.every(count => count === 1)).toBe(true)
  })

  it('joins a failed mutation during quit without restarting its Host', async () => {
    const run = await boot()
    await run.prepared.promise
    run.preparation.resolve()
    await run.cleanupStarted.promise
    const installing = barrier()
    const installed = barrier()
    const failure = new Error('fixture install canceled')
    run.mutate.mockImplementationOnce(async () => {
      installing.resolve()
      await installed.promise
      throw failure
    })
    const pending = expect(run.handlers.get(DESKTOP_IPC.pluginsAdd)!(pluginSender(run), '@fixture/plugin')).rejects.toBe(failure)
    try {
      await installing.promise
      run.app.quit()
      expect(run.calls).not.toContain('quit')
    } finally {
      installed.resolve()
      await pending
    }
    await run.quit.promise
    expect(run.start).toHaveBeenCalledOnce()
    expect(run.hosts.filter(host => host.running)).toEqual([])
  })

  it('reports install and restart failures without launching another Host', async () => {
    const run = await boot()
    await run.prepared.promise
    run.preparation.resolve()
    await run.cleanupStarted.promise
    const installFailure = new Error('fixture pnpm failure')
    const restartFailure = new Error('fixture restart failure')
    run.mutate.mockRejectedValueOnce(installFailure)
    run.start.mockRejectedValueOnce(restartFailure)
    await expect(run.handlers.get(DESKTOP_IPC.pluginsAdd)!(pluginSender(run), '@fixture/plugin')).rejects.toMatchObject({ errors: [installFailure, restartFailure] })
    expect(run.start).toHaveBeenCalledTimes(2)
    expect(run.hosts.filter(host => host.running)).toEqual([])
    expect(run.hostCounts).toEqual([1, 1])
  })

  it.each([false, true])('leaves rollback restart with the transaction when restart fails: %s', async (failRollback) => {
    const run = await boot()
    await run.prepared.promise
    run.preparation.resolve()
    await run.cleanupStarted.promise
    const replacementFailure = new Error('fixture replacement failure')
    const rollbackFailure = new Error('fixture rollback restart failure')
    run.start.mockRejectedValueOnce(replacementFailure)
    if (failRollback) run.start.mockRejectedValueOnce(rollbackFailure)
    run.mutate.mockImplementationOnce(async (_mutation, hooks) => {
      await hooks.beforeActivate()
      try {
        await hooks.afterActivate()
      } catch (error) {
        await hooks.beforeActivate()
        try {
          await hooks.afterActivate()
        } catch (restartError) {
          throw new AggregateError([error, restartError], 'fixture rollback failed')
        }
        throw error
      }
    })
    const pending = run.handlers.get(DESKTOP_IPC.pluginsAdd)!(pluginSender(run), '@fixture/plugin')
    if (failRollback) await expect(pending).rejects.toMatchObject({ errors: [replacementFailure, rollbackFailure] })
    else await expect(pending).rejects.toBe(replacementFailure)
    expect(run.start).toHaveBeenCalledTimes(3)
    expect(run.hosts.filter(host => host.running)).toEqual(failRollback ? [] : [run.hosts[2]])
    expect(run.hostCounts).toEqual([1, 1, 1])
  })

  it('does not restart while recovery leaves an unresolved activation journal', async () => {
    const run = await boot()
    await run.prepared.promise
    run.preparation.resolve()
    await run.cleanupStarted.promise
    const paths = resolveDesktopPaths(run.root)
    mkdirSync(paths.root, { recursive: true })
    writeFileSync(paths.pending, '{}\n')
    const error = new Error('fixture journal recovery failure')
    run.mutate.mockRejectedValueOnce(error)
    await expect(run.handlers.get(DESKTOP_IPC.pluginsAdd)!(pluginSender(run), '@fixture/plugin')).rejects.toBe(error)
    expect(run.start).toHaveBeenCalledOnce()
    expect(run.hosts.filter(host => host.running)).toEqual([])
  })

  it('retains failed Hosts and stops them before a later mutation can recover profiles', async () => {
    const run = await boot()
    await run.prepared.promise
    run.preparation.resolve()
    await run.cleanupStarted.promise
    const normalStop = run.stop.getMockImplementation()!
    const event = pluginSender(run)
    const add = run.handlers.get(DESKTOP_IPC.pluginsAdd)!
    run.stop.mockRejectedValue(new Error('Host still holds files'))
    try {
      await expect(add(event, '@fixture/plugin')).rejects.toThrow('Desktop Host cleanup failed')
      expect(run.mutate).not.toHaveBeenCalled()
      expect(run.maintenance).toHaveBeenCalledOnce()
      await expect(add(event, '@fixture/plugin')).rejects.toThrow('Desktop Host cleanup failed')
      expect(run.mutate).not.toHaveBeenCalled()
      expect(run.maintenance).toHaveBeenCalledOnce()
    } finally {
      run.stop.mockImplementation(normalStop)
    }
    await add(event, '@fixture/plugin')
    expect(run.mutate).toHaveBeenCalledOnce()
    expect(run.maintenance).toHaveBeenCalledTimes(2)
    expect(run.hostCounts.every(count => count === 1)).toBe(true)
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
