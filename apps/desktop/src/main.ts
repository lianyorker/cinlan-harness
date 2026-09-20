/** Electron shell: desktop project ownership, custom protocol, windows, and lifecycle. */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  powerMonitor,
  type IpcMainInvokeEvent,
} from 'electron'
import { resolveDesktopPaths } from './paths.ts'
import { DesktopProjectManager, type DesktopProjectHooks } from './project-manager.ts'
import { DesktopHostProcess, DesktopHostUncleanExitError } from './host-process.ts'
import { DESKTOP_IPC, type DesktopUpdateState } from './ipc.ts'
import { resolveDesktopLocale } from './locale.ts'
import { claimDesktopSingleInstance } from './single-instance.ts'
import { DesktopUpdateRuntime } from './update-runtime.ts'
import { DesktopUpdatePreparationError } from './update-error.ts'
import { presentDesktopUpdate } from './update-presentation.ts'
import { parseDesktopRelease } from './release.ts'
import { DesktopFatalRecovery } from './fatal-recovery.ts'
import { installFloatingWindowPolicy, type FloatingWindowPolicy } from './floating-window.ts'
import { writeStartupDiagnostic } from './startup-diagnostic.ts'
import { DesktopStartup } from './startup.ts'
import { desktopMenuTemplate } from './desktop-menu.ts'
import { prepareDesktopProfile } from './startup-preparation.ts'
import { desktopStartupTheme, localizeStartupDocument } from './startup-document.ts'

const SCHEME = 'dsh-app'
let focusPrimaryWindow = (): void => {}

function errorOf(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback)
}

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false,
    stream: true,
    codeCache: true,
  },
}])

const CSS_MIME = 'text/css; charset=utf-8'
const MIME: Readonly<Record<string, string>> = {
  '.css': CSS_MIME,
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}

interface RuntimeResources {
  readonly node: string
  readonly pnpm: string
  readonly seed: string
  readonly primaryRuntime: string
}

function runtimeResources(): RuntimeResources {
  const development = !app.isPackaged
  const node = (development ? process.env.DSH_DESKTOP_NODE_BINARY : undefined)
    ?? join(process.resourcesPath, 'runtime', 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  const pnpm = (development ? process.env.DSH_DESKTOP_PNPM_ENTRY : undefined)
    ?? join(process.resourcesPath, 'runtime', 'pnpm', 'bin', 'pnpm.mjs')
  const seed = (development ? process.env.DSH_DESKTOP_SEED_DIR : undefined) ?? join(process.resourcesPath, 'seed')
  const primaryRuntime = (development ? process.env.DSH_DESKTOP_PRIMARY_RUNTIME : undefined)
    ?? join(process.resourcesPath, 'runtime', 'primary-runtime')
  return { node, pnpm, seed, primaryRuntime }
}

function developmentProject(): string | undefined {
  const configured = process.env.DSH_DESKTOP_DEV_PROJECT_DIR
  if (configured === undefined || configured === '') return undefined
  if (app.isPackaged) throw new Error('dsh desktop: development project override is unavailable in packaged applications')
  return resolve(configured)
}

function developmentHostInspectPort(enabled: boolean): number | undefined {
  const configured = process.env.DSH_DESKTOP_HOST_INSPECT_PORT
  if (!enabled || configured === undefined || configured === '') return undefined
  const port = Number(configured)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('dsh desktop: DSH_DESKTOP_HOST_INSPECT_PORT must be an integer from 1 through 65535')
  }
  return port
}

function createWindow(preload: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 880,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).protocol !== `${SCHEME}:`) event.preventDefault()
  })
  return window
}

function assertDesktopSender(event: IpcMainInvokeEvent, hostnames: readonly string[]): URL {
  const senderFrame = event.senderFrame
  if (senderFrame === null) throw new Error('dsh desktop: rejected IPC without a sender frame')
  const url = new URL(senderFrame.url)
  if (url.protocol !== `${SCHEME}:` || !hostnames.includes(url.hostname)) {
    throw new Error('dsh desktop: rejected IPC from an unowned renderer')
  }
  return url
}

async function serveShellAsset(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
  const root = resolve(app.getAppPath(), 'renderer')
  const url = new URL(request.url)
  if (url.pathname === '/startup-theme.css') {
    return new Response(request.method === 'HEAD' ? null : desktopStartupTheme(), { headers: { 'content-type': CSS_MIME } })
  }
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return new Response(null, { status: 400 })
  }
  const assetRoot = pathname === '/loading.js' || pathname === '/loading.css'
    ? resolve(app.getAppPath(), 'lib', 'renderer') : root
  const target = resolve(normalize(join(assetRoot, pathname)))
  if (target !== assetRoot && !target.startsWith(assetRoot + sep)) return new Response(null, { status: 403 })
  try {
    const bytes = request.method === 'HEAD' ? null : await readFile(target)
    const body = bytes !== null && pathname === '/startup.html'
      ? localizeStartupDocument(bytes.toString('utf8'), resolveDesktopLocale(app.getLocale()))
      : bytes
    return new Response(body, { headers: { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' } })
  } catch {
    return new Response(null, { status: 404 })
  }
}

async function main(): Promise<void> {
  const resources = runtimeResources()
  const paths = resolveDesktopPaths()
  const development = developmentProject()
  const activeProject = development ?? paths.profile
  const hostInspectPort = developmentHostInspectPort(development !== undefined)
  const manager = new DesktopProjectManager(paths, resources)
  let host: DesktopHostProcess | undefined
  let mainWindow: BrowserWindow | undefined
  let pluginWindow: BrowserWindow | undefined
  let floatingWindows: FloatingWindowPolicy | undefined
  let shellInstallerOwnsQuit = false
  let quitting = false
  const isQuitting = (): boolean => quitting
  let quitReady = false
  let quitTask: Promise<void> | undefined
  let mutationTask: Promise<void> | undefined
  let cleanupTask: Promise<void> | undefined
  const cleanupCancellation = new AbortController()
  let updatePreparing = false
  let updateStoppedHost = false
  let updateRecovery: Promise<void> | undefined
  let updateStopFailure: Error | undefined
  let reportFatal = (error: unknown): void => { console.error(error) }
  const ownedHosts = new Set<DesktopHostProcess>()
  const startupUrl = `${SCHEME}://shell/startup.html`
  let updateState: DesktopUpdateState = { phase: 'idle' }
  const locale = resolveDesktopLocale(app.getLocale())
  const messages = locale.messages
  const appPreload = fileURLToPath(new URL('./preload-app.cjs', import.meta.url))
  const managementPreload = fileURLToPath(new URL('./preload.cjs', import.meta.url))

  const publishUpdate = (state: DesktopUpdateState): DesktopUpdateState => {
    updateState = state
    if (state.phase === 'error' && state.failedOperation === 'install' && updateStoppedHost && !quitting) {
      void recoverUpdateHost().catch(reportFatal)
    }
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(DESKTOP_IPC.updatesState, state)
      window.webContents.send(DESKTOP_IPC.updatesPresentation, presentDesktopUpdate(state))
    }
    return state
  }

  const stopHost = async (active: DesktopHostProcess | undefined): Promise<void> => {
    if (active === undefined) return
    await active.stop()
    ownedHosts.delete(active)
  }
  const stopHosts = async (): Promise<void> => {
    host = undefined
    const results = await Promise.allSettled([...ownedHosts].map(active => stopHost(active)))
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (errors.length > 0) throw new AggregateError(errors, 'Desktop Host cleanup failed')
  }
  const startHost = async (projectDir = activeProject): Promise<DesktopHostProcess> => {
    if (isQuitting()) throw new Error('Desktop is closing')
    const next = new DesktopHostProcess(resources.node, projectDir, hostInspectPort, development !== undefined, (error) => {
      if (host === next && !quitting && !updatePreparing && !updateStoppedHost) reportFatal(error)
    }, resources.primaryRuntime)
    ownedHosts.add(next)
    try {
      await next.start()
      if (isQuitting()) throw new Error('Desktop is closing')
      return next
    } catch (error) {
      await stopHost(next)
      throw error
    }
  }
  const hooks: DesktopProjectHooks = {
    healthCheck: async (projectDir) => {
      try {
        const probe = await startHost(projectDir)
        await stopHost(probe)
      } catch (error) {
        try {
          await stopHosts()
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'desktop project: staged health check and Host cleanup failed')
        }
        throw error
      }
    },
    beforeActivate: async () => {
      floatingWindows?.close()
      await stopHosts()
    },
    afterActivate: async () => {
      if (!isQuitting()) host = await startHost()
    },
  }

  const recoverUpdateHost = (): Promise<void> => {
    if (updateRecovery !== undefined) return updateRecovery
    shellInstallerOwnsQuit = false
    updateStoppedHost = false
    updateRecovery = (async () => {
      if (isQuitting()) return
      if (ownedHosts.size !== 0) throw new Error('Desktop update recovery still owns an unconfirmed Host')
      host = await startHost()
      if (isQuitting()) return
      updateStopFailure = undefined
      const window = mainWindow
      if (window !== undefined && !window.isDestroyed()) await window.loadURL('dsh-app://app/index.html')
    })().finally(() => { updateRecovery = undefined; updatePreparing = false })
    return updateRecovery
  }
  const prepareUpdate = async (): Promise<boolean> => {
    await updateRecovery
    if (isQuitting()) return false
    if (updateStopFailure !== undefined) throw updateStopFailure
    if (fatalRecovery.active) return false
    if (updatePreparing || mutationTask !== undefined || startup.state.phase !== 'ready') {
      throw new DesktopUpdatePreparationError('tasks-unavailable', messages.updateTasksUnavailable)
    }
    updatePreparing = true
    let lockedHost: DesktopHostProcess | undefined
    try {
      await cleanupTask
      if (isQuitting()) return false
      const activeHost = host
      if (activeHost === undefined) throw new DesktopUpdatePreparationError('tasks-unavailable', messages.updateTasksUnavailable)
      const active = await activeHost.updateTasks('inspect')
      const version = updates.state.version
      if (version === undefined || !await updates.confirm(version, active) || isQuitting()) return false
      if (host !== activeHost) throw new DesktopUpdatePreparationError('tasks-unavailable', messages.updateTasksUnavailable)
      lockedHost = activeHost
      const stillActive = await activeHost.updateTasks('lock')
      if (stillActive && !active) throw new DesktopUpdatePreparationError('tasks-changed', messages.updateTasksChanged)
      if (isQuitting()) return false
      updates.record('install-confirmed')
      updates.preparingRestart(active)
      floatingWindows?.close()
      try { await activeHost.stop(true) } catch (error) {
        updateStopFailure = errorOf(error, 'Desktop Host shutdown was not confirmed')
        if (error instanceof DesktopHostUncleanExitError) {
          ownedHosts.delete(activeHost)
          host = undefined
          updateStoppedHost = true
        }
        throw new DesktopUpdatePreparationError('stop-failed', messages.updateStopFailed, updateStopFailure.message)
      }
      ownedHosts.delete(activeHost)
      host = undefined
      updateStoppedHost = true
      if (isQuitting()) return false
      shellInstallerOwnsQuit = true
      return true
    } finally {
      if (!updateStoppedHost && lockedHost !== undefined) {
        await lockedHost.updateTasks('unlock').catch((error: unknown) => { console.error(error) })
      }
      if (!shellInstallerOwnsQuit && !updateStoppedHost) updatePreparing = false
    }
  }
  const updates = new DesktopUpdateRuntime({
    locale, window: () => mainWindow, publish: publishUpdate, beforeRestart: prepareUpdate,
    bundledVersion: async () => app.isPackaged
      ? parseDesktopRelease(JSON.parse(await readFile(join(resources.seed, 'desktop-release.json'), 'utf8')) as unknown).version
      : app.getVersion(),
    policyChanged: (blocking) => {
      if (!blocking) return
      floatingWindows?.close()
      if (pluginWindow !== undefined && !pluginWindow.isDestroyed()) pluginWindow.close()
    },
  })

  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url)
    if (url.hostname === 'shell') return serveShellAsset(request)
    if (url.hostname !== 'app') return Promise.resolve(new Response(null, { status: 404 }))
    const active = host
    if (active === undefined) return Promise.resolve(new Response('backend unavailable', { status: 503 }))
    return active.fetch(request)
  })

  const cleanupStaging = (): void => {
    if (development !== undefined || isQuitting() || updatePreparing || updateRecovery !== undefined || cleanupTask !== undefined) return
    // A failed probe or replacement start can still hold files in a staged profile.
    if ([...ownedHosts].some(owned => owned !== host)) return
    cleanupTask = manager.cleanupOrphanedStaging(cleanupCancellation.signal)
      .catch((error: unknown) => {
        if (!cleanupCancellation.signal.aborted) console.warn('Desktop staging maintenance was deferred', error)
      })
      .finally(() => { cleanupTask = undefined })
  }
  const assertPluginSender = (event: IpcMainInvokeEvent): void => {
    const url = assertDesktopSender(event, ['shell'])
    if (event.sender !== pluginWindow?.webContents || event.senderFrame !== event.sender.mainFrame
      || url.pathname !== '/plugin-manager.html') throw new Error('Desktop plugin operation requires its owned document')
  }
  const mutate = async (event: IpcMainInvokeEvent, mutation: Parameters<DesktopProjectManager['mutate']>[0]): Promise<void> => {
    assertPluginSender(event)
    if (updates.blocking || updatePreparing || updateRecovery !== undefined || updateStopFailure !== undefined || fatalRecovery.active) throw new Error('Desktop updates prevent package changes')
    if (development !== undefined) {
      throw new Error('dsh desktop: plugin package changes require a packaged application')
    }
    if (isQuitting() || startup.state.phase !== 'ready') throw new Error('Desktop is not ready for package changes')
    if (mutationTask !== undefined) throw new Error('Desktop package changes are already in progress')
    mutationTask = (async () => {
      await cleanupTask
      if (isQuitting()) throw new Error('Desktop is closing')
      await hooks.beforeActivate()
      let activationStarted = false
      try {
        await manager.mutate(mutation, {
          ...hooks,
          beforeActivate: async () => {
            activationStarted = true
            await hooks.beforeActivate()
          },
        })
      } catch (error) {
        // Activation owns rollback and restart once directory replacement begins.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- beforeActivate runs during the awaited transaction.
        if (!activationStarted && ownedHosts.size === 0 && !existsSync(paths.pending) && !isQuitting()) {
          try {
            await hooks.afterActivate()
          } catch (restartError) {
            throw new AggregateError([error, restartError], 'desktop project: mutation and active backend restart failed')
          }
        }
        throw error
      }
    })()
    try {
      await mutationTask
      if (!isQuitting() && mainWindow !== undefined && !mainWindow.isDestroyed()) mainWindow.webContents.reload()
    } finally {
      mutationTask = undefined
      cleanupStaging()
    }
  }
  ipcMain.handle(DESKTOP_IPC.localeGet, (event) => {
    assertDesktopSender(event, ['shell'])
    return locale
  })
  ipcMain.handle(DESKTOP_IPC.pluginsList, (event) => {
    assertPluginSender(event)
    if (development !== undefined) return []
    return manager.listPlugins()
  })
  ipcMain.handle(DESKTOP_IPC.pluginsAdd, (event, spec: unknown) => {
    if (typeof spec !== 'string') throw new Error('dsh desktop: plugin spec must be a string')
    return mutate(event, { type: 'plugin-add', spec })
  })
  ipcMain.handle(DESKTOP_IPC.pluginsRemove, (event, name: unknown) => {
    if (typeof name !== 'string') throw new Error('dsh desktop: plugin name must be a string')
    return mutate(event, { type: 'plugin-remove', name })
  })
  ipcMain.handle(DESKTOP_IPC.pluginsUpdate, (event, name: unknown, version: unknown) => {
    if (typeof name !== 'string' || typeof version !== 'string') {
      throw new Error('dsh desktop: plugin name and version must be strings')
    }
    return mutate(event, { type: 'plugin-update', name, version })
  })
  const assertUpdateSender = (event: IpcMainInvokeEvent): void => {
    const url = assertDesktopSender(event, ['app', 'shell'])
    const window = url.hostname === 'app' ? mainWindow : pluginWindow
    if (event.sender !== window?.webContents || event.senderFrame !== event.sender.mainFrame
      || (url.hostname === 'shell' && url.pathname !== '/plugin-manager.html')) {
      throw new Error('Desktop update operation requires an owned application document')
    }
  }
  ipcMain.handle(DESKTOP_IPC.updatesCheck, async (event) => {
    assertUpdateSender(event)
    await updates.open(true)
    return updates.state
  })
  ipcMain.handle(DESKTOP_IPC.updatesInstall, async (event) => {
    assertUpdateSender(event)
    await updates.open()
  })
  ipcMain.handle(DESKTOP_IPC.updatesStatus, (event) => {
    assertUpdateSender(event)
    return presentDesktopUpdate(updates.state)
  })
  ipcMain.handle(DESKTOP_IPC.updatesOpen, async (event) => {
    assertUpdateSender(event)
    await updates.open(true)
  })

  const openPluginWindow = (): void => {
    if (isQuitting() || startup.state.phase !== 'ready' || updatePreparing || updateRecovery !== undefined || fatalRecovery.active) return
    if (updates.blocking) { updates.focus(); return }
    if (pluginWindow !== undefined && !pluginWindow.isDestroyed()) {
      pluginWindow.focus()
      return
    }
    pluginWindow = createWindow(managementPreload)
    pluginWindow.setSize(900, 620)
    pluginWindow.setTitle(messages.pluginWindowTitle)
    pluginWindow.once('ready-to-show', () => { pluginWindow?.show() })
    pluginWindow.once('closed', () => { pluginWindow = undefined })
    void pluginWindow.loadURL(`${SCHEME}://shell/plugin-manager.html`)
  }
  ipcMain.handle(DESKTOP_IPC.openPluginsWindow, (event) => {
    const url = assertDesktopSender(event, ['app'])
    if (url.host !== 'app') throw new Error('dsh desktop: rejected plugin window origin')
    openPluginWindow()
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(desktopMenuTemplate({
    platform: process.platform,
    appName: app.name,
    messages,
    development: development !== undefined,
    openPlugins: openPluginWindow,
    checkUpdates: () => { void updates.open(true).catch((error: unknown) => { reportFatal(error) }) },
  })))

  const createMainWindow = (): BrowserWindow => {
    const window = createWindow(appPreload)
    mainWindow = window
    const floating = installFloatingWindowPolicy(window, appPreload, options => new BrowserWindow(options),
      () => !updates.blocking && !updatePreparing && !isQuitting() && !fatalRecovery.active)
    floatingWindows = floating
    window.on('focus', () => { updates.automaticCheck(); if (updates.blocking) updates.focus() })
    window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
    window.webContents.on('render-process-gone', (_event, details) => {
      if (!isQuitting() && !shellInstallerOwnsQuit) reportFatal(new Error('Desktop renderer stopped: ' + details.reason))
    })
    window.on('close', (event) => {
      if (quitReady || shellInstallerOwnsQuit) return
      if (startup.state.phase !== 'ready' || process.platform !== 'darwin') {
        event.preventDefault()
        void requestQuit(false)
      }
    })
    window.on('closed', () => {
      floating.dispose()
      if (floatingWindows === floating) floatingWindows = undefined
      if (mainWindow === window) mainWindow = undefined
    })
    return window
  }
  const showStartup = async (signal?: AbortSignal): Promise<void> => {
    const window = mainWindow ?? createMainWindow()
    await window.loadURL(startupUrl)
    if (window.isDestroyed()) throw new Error('Desktop startup window closed before display')
    window.show()
    // A visible compositor frame precedes seed verification, extraction, or package installation.
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => {
        signal?.removeEventListener('abort', abort)
        reject(errorOf(signal?.reason, 'Desktop startup canceled'))
      }
      signal?.addEventListener('abort', abort, { once: true })
      void window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))')
        .then(() => { resolve() }, (error: unknown) => { reject(errorOf(error, 'Desktop startup page could not paint')) })
        .finally(() => { signal?.removeEventListener('abort', abort) })
      if (signal?.aborted === true) abort()
    })
  }
  const startup = new DesktopStartup({
    show: showStartup,
    prepare: async (signal, report) => {
      if (development === undefined) {
        await prepareDesktopProfile({
          paths, runtime: resources, primaryRuntime: resources.primaryRuntime, seed: resources.seed, version: app.getVersion(),
        }, signal, report)
      }
    },
    startHost: async () => { host = await startHost() },
    openApp: async () => {
      const window = mainWindow
      if (window === undefined || window.isDestroyed()) throw new Error('Desktop window closed before application load')
      await window.loadURL(`${SCHEME}://app/index.html`)
    },
    stopHosts,
    diagnose: async (error) => {
      console.error(error)
      return writeStartupDiagnostic(error, paths.root)
    },
    publish: (state) => {
      const window = mainWindow
      if (window === undefined || window.isDestroyed()) return
      if (state.phase === 'error' && window.webContents.getURL() !== startupUrl) {
        void showStartup().catch((error: unknown) => {
          console.error(error)
          dialog.showErrorBox(messages.startupFailed, state.message)
        })
      } else {
        window.webContents.send(DESKTOP_IPC.startupState, state)
      }
    },
  })
  const finishWork = async (): Promise<void> => {
    quitting = true
    updates.record('quit-requested')
    powerMonitor.off('resume', updates.automaticCheck)
    const updatesDisposed = updates.dispose()
    floatingWindows?.close()
    cleanupCancellation.abort(new Error('Desktop staging maintenance canceled'))
    const results = await Promise.allSettled([startup.close(), mutationTask, cleanupTask, updateRecovery, updatesDisposed])
    // Mutations can finish rollback after the initial child stop; their hooks never launch while quitting.
    await stopHosts()
    const shutdown = results[0]
    if (shutdown.status === 'rejected') throw shutdown.reason
    const updateShutdown = results[4]
    if (updateShutdown.status === 'rejected') throw updateShutdown.reason
  }
  const fatalRecovery = new DesktopFatalRecovery({
    messages: () => messages,
    show: options => dialog.showMessageBox(options),
    stop: finishWork,
    disablePlugins: async () => { await manager.disableThirdPartyPlugins() },
    exit: () => { app.exit(1) },
    restart: () => { app.relaunch(); app.exit(0) },
  })
  reportFatal = (error) => {
    if (isQuitting() || fatalRecovery.active) return
    console.error(error)
    updates.record('workspace-failed')
    void updates.dispose().catch((failure: unknown) => { console.error(failure) })
    floatingWindows?.close()
    if (pluginWindow !== undefined && !pluginWindow.isDestroyed()) pluginWindow.close()
    void writeStartupDiagnostic(error, paths.root).catch((failure: unknown) => { console.error(failure) })
    void fatalRecovery.report(error).catch((failure: unknown) => { console.error(failure); app.exit(1) })
  }
  const requestQuit = (restart: boolean): Promise<void> => {
    quitTask ??= (async () => {
      try {
        await finishWork()
        if (restart) app.relaunch()
        quitReady = true
        app.quit()
      } catch (error) {
        console.error(error)
        quitTask = undefined
      }
    })()
    return quitTask
  }
  const assertStartupSender = (event: IpcMainInvokeEvent): void => {
    assertDesktopSender(event, ['shell'])
    if (event.sender !== mainWindow?.webContents || event.senderFrame?.url !== startupUrl
      || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Desktop startup operation requires the primary startup document')
    }
  }
  ipcMain.handle(DESKTOP_IPC.startupGet, (event) => {
    assertStartupSender(event)
    return { locale, state: startup.state }
  })
  ipcMain.handle(DESKTOP_IPC.startupQuit, (event) => {
    assertStartupSender(event)
    void requestQuit(false)
  })
  ipcMain.handle(DESKTOP_IPC.startupRestart, (event) => {
    assertStartupSender(event)
    if (startup.state.phase !== 'error' || !startup.state.canRestart) throw new Error('Desktop cannot safely restart')
    void requestQuit(true)
  })
  focusPrimaryWindow = () => {
    if (isQuitting()) return
    const window = mainWindow
    if (window === undefined || window.isDestroyed()) {
      const replacement = createMainWindow()
      void replacement.loadURL(startup.state.phase === 'ready' ? `${SCHEME}://app/index.html` : startupUrl)
        .catch((error: unknown) => { console.error(error) })
      return
    }
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) focusPrimaryWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', (event) => {
    if (shellInstallerOwnsQuit) {
      updates.record('quit-requested')
      return
    }
    if (quitReady) return
    event.preventDefault()
    void requestQuit(false)
  })

  powerMonitor.on('resume', updates.automaticCheck)
  const starting = startup.start()
  void updates.start().catch(reportFatal)
  await starting
  if (startup.state.phase !== 'ready' || isQuitting()) return
  cleanupStaging()
  if (development !== undefined && process.env.DSH_DESKTOP_OPEN_DEVTOOLS !== '0') {
    mainWindow?.webContents.openDevTools({ mode: 'detach' })
  }
  publishUpdate(updateState)
  updates.record('workspace-ready')
}

const ownsDesktopInstance = claimDesktopSingleInstance(app, () => { focusPrimaryWindow() })

if (ownsDesktopInstance) void app.whenReady().then(main).catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(error)
  await writeStartupDiagnostic(error, resolveDesktopPaths().root)
  dialog.showErrorBox(resolveDesktopLocale(app.getLocale()).messages.startupFailed, message)
  app.exit(1)
})
