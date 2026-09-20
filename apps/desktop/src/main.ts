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
  type IpcMainInvokeEvent,
} from 'electron'
import { resolveDesktopPaths } from './paths.ts'
import { DesktopProjectManager, type DesktopProjectHooks } from './project-manager.ts'
import { DesktopHostProcess } from './host-process.ts'
import { DESKTOP_IPC, type DesktopUpdateState } from './ipc.ts'
import { formatDesktopMessage, resolveDesktopLocale } from './locale.ts'
import { claimDesktopSingleInstance } from './single-instance.ts'
import { DesktopUpdateCoordinator } from './update-coordinator.ts'
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
}

function runtimeResources(): RuntimeResources {
  const development = !app.isPackaged
  const node = (development ? process.env.DSH_DESKTOP_NODE_BINARY : undefined)
    ?? join(process.resourcesPath, 'runtime', 'node', process.platform === 'win32' ? 'node.exe' : 'node')
  const pnpm = (development ? process.env.DSH_DESKTOP_PNPM_ENTRY : undefined)
    ?? join(process.resourcesPath, 'runtime', 'pnpm', 'bin', 'pnpm.mjs')
  const seed = (development ? process.env.DSH_DESKTOP_SEED_DIR : undefined) ?? join(process.resourcesPath, 'seed')
  return { node, pnpm, seed }
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
  let updateTimer: ReturnType<typeof setTimeout> | undefined
  const ownedHosts = new Set<DesktopHostProcess>()
  const startupUrl = `${SCHEME}://shell/startup.html`
  let updateState: DesktopUpdateState = { phase: 'idle' }
  const locale = resolveDesktopLocale(app.getLocale())
  const messages = locale.messages
  const appPreload = fileURLToPath(new URL('./preload-app.cjs', import.meta.url))
  const managementPreload = fileURLToPath(new URL('./preload.cjs', import.meta.url))

  const publishUpdate = (state: DesktopUpdateState): DesktopUpdateState => {
    updateState = state
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(DESKTOP_IPC.updatesState, state)
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
    const next = new DesktopHostProcess(resources.node, projectDir, hostInspectPort, development !== undefined)
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

  const updates = new DesktopUpdateCoordinator(
    publishUpdate,
    async () => {
      await finishWork()
      shellInstallerOwnsQuit = true
    },
  )

  protocol.handle(SCHEME, (request) => {
    const url = new URL(request.url)
    if (url.hostname === 'shell') return serveShellAsset(request)
    if (url.hostname !== 'app') return Promise.resolve(new Response(null, { status: 404 }))
    const active = host
    if (active === undefined) return Promise.resolve(new Response('backend unavailable', { status: 503 }))
    return active.fetch(request)
  })

  const cleanupStaging = (): void => {
    if (development !== undefined || isQuitting() || cleanupTask !== undefined) return
    // A failed probe or replacement start can still hold files in a staged profile.
    if ([...ownedHosts].some(owned => owned !== host)) return
    cleanupTask = manager.cleanupOrphanedStaging(cleanupCancellation.signal)
      .catch((error: unknown) => {
        if (!cleanupCancellation.signal.aborted) console.warn('Desktop staging maintenance was deferred', error)
      })
      .finally(() => { cleanupTask = undefined })
  }
  const mutate = async (event: IpcMainInvokeEvent, mutation: Parameters<DesktopProjectManager['mutate']>[0]): Promise<void> => {
    assertDesktopSender(event, ['shell'])
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
    assertDesktopSender(event, ['shell'])
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
  ipcMain.handle(DESKTOP_IPC.updatesCheck, async (event) => {
    assertDesktopSender(event, ['shell'])
    return updates.check()
  })
  ipcMain.handle(DESKTOP_IPC.updatesInstall, async (event) => {
    assertDesktopSender(event, ['shell'])
    await updates.install()
  })

  const checkAndPrompt = async (manual: boolean): Promise<void> => {
    if (isQuitting() || startup.state.phase !== 'ready') return
    const state = await updates.check()
    if (isQuitting()) return
    if (state.phase === 'error') {
      if (manual) {
        await dialog.showMessageBox({
          type: 'error',
          title: messages.updateCheckFailedTitle,
          message: state.message ?? messages.unknownError,
        })
      }
      return
    }
    if (state.phase !== 'available') {
      if (manual) {
        await dialog.showMessageBox({
          type: 'info',
          title: messages.updateCheckTitle,
          message: state.message ?? messages.updateCurrent,
        })
      }
      return
    }
    const result = await dialog.showMessageBox({
      type: 'info',
      title: messages.updateTitle,
      message: messages.updateAvailable,
      detail: formatDesktopMessage(messages.updateDetail, { version: state.version ?? '' }),
      buttons: [messages.installAndRestart, messages.later],
      defaultId: 0,
      cancelId: 1,
    })
    if (result.response !== 0) return
    const installed = await updates.install()
    if (installed.phase === 'error') {
      await dialog.showMessageBox({
        type: 'error',
        title: messages.updateFailedTitle,
        message: installed.message ?? messages.unknownError,
      })
    }
  }

  const openPluginWindow = (): void => {
    if (isQuitting() || startup.state.phase !== 'ready') return
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
    checkUpdates: () => { void checkAndPrompt(true) },
  })))

  const createMainWindow = (): BrowserWindow => {
    const window = createWindow(appPreload)
    mainWindow = window
    const floating = installFloatingWindowPolicy(window, appPreload, options => new BrowserWindow(options))
    floatingWindows = floating
    window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
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
        await prepareDesktopProfile({ paths, runtime: resources, seed: resources.seed, version: app.getVersion() }, signal, report)
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
    if (updateTimer !== undefined) {
      clearTimeout(updateTimer)
      updateTimer = undefined
    }
    floatingWindows?.close()
    cleanupCancellation.abort(new Error('Desktop staging maintenance canceled'))
    const results = await Promise.allSettled([startup.close(), mutationTask, cleanupTask])
    // Mutations can finish rollback after the initial child stop; their hooks never launch while quitting.
    await stopHosts()
    const shutdown = results[0]
    if (shutdown.status === 'rejected') throw shutdown.reason
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
    if (quitReady || shellInstallerOwnsQuit) return
    event.preventDefault()
    void requestQuit(false)
  })

  await startup.start()
  if (startup.state.phase !== 'ready' || isQuitting()) return
  cleanupStaging()
  if (development !== undefined && process.env.DSH_DESKTOP_OPEN_DEVTOOLS !== '0') {
    mainWindow?.webContents.openDevTools({ mode: 'detach' })
  }
  publishUpdate(updateState)
  updateTimer = setTimeout(() => { void checkAndPrompt(false) }, 10_000)
}

const ownsDesktopInstance = claimDesktopSingleInstance(app, () => { focusPrimaryWindow() })

if (ownsDesktopInstance) void app.whenReady().then(main).catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(error)
  await writeStartupDiagnostic(error, resolveDesktopPaths().root)
  dialog.showErrorBox(resolveDesktopLocale(app.getLocale()).messages.startupFailed, message)
  app.exit(1)
})
