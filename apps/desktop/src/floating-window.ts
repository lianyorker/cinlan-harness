/** Native admission and opener-owned lifetime for floating views of the Desktop app artifact. */
import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Event,
  HandlerDetails,
  WebContents,
  WebContentsDidStartNavigationEventParams,
  WebContentsWillNavigateEventParams,
  WebContentsWillRedirectEventParams,
  WindowOpenHandlerResponse,
} from 'electron'

const APP_URL = 'dsh-app://app/index.html'
const OWNER_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u

interface FloatingRoute {
  readonly owner: string
  readonly session: string | null
}

/** Native controls retained by the main application window. */
export interface FloatingWindowPolicy {
  /** Destroy this opener's child and cancel pending admission without disabling future user opens. */
  close(): void
  /** Destroy the child, detach lifecycle listeners, and deny further opens; safe to call repeatedly. */
  dispose(): void
}

const policies = new WeakMap<BrowserWindow, FloatingWindowPolicy>()

function routeOf(value: string): FloatingRoute | undefined {
  if (!value.startsWith(APP_URL + '?') || value.includes('#') || CONTROL_PATTERN.test(value)) return undefined
  const params = new URLSearchParams(value.slice(APP_URL.length + 1))
  const allowed = new Set(['dsh-floating-workspace', 'dsh-floating-owner', 'dsh-floating-session'])
  for (const key of params.keys()) {
    if (!allowed.delete(key)) return undefined
  }
  if (params.get('dsh-floating-workspace') !== '1') return undefined
  const owner = params.get('dsh-floating-owner')
  if (owner === null || !OWNER_PATTERN.test(owner)) return undefined
  const session = params.get('dsh-floating-session')
  if (session !== null && (session.length === 0 || session.length > 512 || CONTROL_PATTERN.test(session))) return undefined
  return { owner, session }
}

function dimensionsOf(features: string): { width: number; height: number } | undefined {
  const match = /^popup=yes,width=([1-9][0-9]{2}),height=([1-9][0-9]{2})$/u.exec(features)
  if (match === null) return undefined
  const width = Number(match[1]), height = Number(match[2])
  return width >= 200 && width <= 800 && height >= 150 && height <= 600 ? { width, height } : undefined
}

function deny(): WindowOpenHandlerResponse {
  return { action: 'deny' }
}

/**
 * Admit one securely configured app child at a time from the exact main app document.
 * @param owner - main app BrowserWindow, never the plugin manager or a child window.
 * @param preload - the same trusted app preload used by the main app window.
 * @param createWindow - native BrowserWindow constructor capability; must use the supplied options unchanged.
 * @param allowed - Main-owned admission predicate, rechecked before native creation.
 * @returns idempotent child-close and policy-disposal controls; OS bounds may clamp requested dimensions.
 */
export function installFloatingWindowPolicy(
  owner: BrowserWindow,
  preload: string,
  createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow,
  allowed: () => boolean = () => true,
): FloatingWindowPolicy {
  policies.get(owner)?.dispose()
  const contents = owner.webContents
  let disposed = false
  let navigating = false
  let pending: object | undefined
  let child: { window: BrowserWindow; detach(): void } | undefined

  const ownerAlive = () => !owner.isDestroyed() && !contents.isDestroyed()
  const mayOpen = () => !disposed && !navigating && allowed() && ownerAlive() && contents.getURL() === APP_URL

  function close(): void {
    pending = undefined
    const current = child
    if (current === undefined) return
    child = undefined
    current.detach()
    if (!current.window.isDestroyed()) current.window.destroy()
    if (ownerAlive()) owner.focus()
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    contents.off('did-start-navigation', onOwnerNavigation)
    contents.off('did-finish-load', onOwnerLoaded)
    contents.off('destroyed', dispose)
    contents.off('render-process-gone', close)
    owner.off('closed', dispose)
    if (!contents.isDestroyed()) contents.setWindowOpenHandler(deny)
    close()
    if (policies.get(owner) === policy) policies.delete(owner)
  }

  function onOwnerNavigation(event: Event<WebContentsDidStartNavigationEventParams>): void {
    if (!event.isMainFrame) return
    navigating = !event.isSameDocument
    close()
  }

  function onOwnerLoaded(): void {
    navigating = false
  }

  function attach(window: BrowserWindow, route: FloatingRoute): void {
    const childContents = window.webContents
    const guard = (event: Event<WebContentsWillNavigateEventParams | WebContentsWillRedirectEventParams>) => {
      if (!event.isMainFrame) return
      const next = routeOf(event.url)
      if (next === undefined || next.owner !== route.owner || next.session !== route.session) event.preventDefault()
    }
    const detach = () => {
      childContents.off('will-navigate', guard)
      childContents.off('will-redirect', guard)
      window.off('closed', onChildClosed)
    }
    const onChildClosed = () => {
      detach()
      if (child?.window !== window) return
      child = undefined
      if (ownerAlive()) owner.focus()
    }
    try {
      childContents.setWindowOpenHandler(deny)
      childContents.on('will-navigate', guard)
      childContents.on('will-redirect', guard)
      window.once('closed', onChildClosed)
      child = { window, detach }
    } catch (error) {
      detach()
      throw error
    }
  }

  function admit(details: HandlerDetails): WindowOpenHandlerResponse {
    if (!mayOpen() || pending !== undefined || child !== undefined) return deny()
    if (details.disposition !== 'new-window' || details.postBody != null) return deny()
    if (details.referrer.url !== '' && details.referrer.url !== APP_URL) return deny()
    const route = routeOf(details.url), dimensions = dimensionsOf(details.features)
    if (route === undefined || dimensions === undefined || details.frameName !== 'dsh-floating-workspace-' + route.owner) return deny()
    const reservation = {}
    pending = reservation
    const secureOptions = (): BrowserWindowConstructorOptions => ({
      ...dimensions,
      minWidth: 200, minHeight: 150,
      parent: owner,
      show: true,
      webPreferences: {
        preload, sandbox: true, contextIsolation: true, webSecurity: true,
        nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
        webviewTag: false, allowRunningInsecureContent: false, navigateOnDragDrop: false,
      },
    })
    return {
      action: 'allow',
      outlivesOpener: false,
      overrideBrowserWindowOptions: secureOptions(),
      createWindow(options) {
        // Electron's constructor handoff includes this native handle, omitted from its public options declaration.
        const guest = (options as BrowserWindowConstructorOptions & { webContents?: WebContents }).webContents
        const releaseGuest = () => {
          if (guest !== undefined && !guest.isDestroyed()) guest.close({ waitForBeforeUnload: false })
        }
        if (!mayOpen() || pending !== reservation) {
          if (pending === reservation) pending = undefined
          releaseGuest()
          throw new Error('Floating window admission expired before native creation')
        }
        let window: BrowserWindow | undefined
        try {
          if (guest === undefined) throw new Error('Floating window creation requires native child WebContents')
          const nativeOptions = { ...secureOptions(), webContents: guest }
          window = createWindow(nativeOptions)
          if (!mayOpen() || pending !== reservation) throw new Error('Floating window owner changed during native creation')
          attach(window, route)
          return window.webContents
        } catch (error) {
          if (window !== undefined && !window.isDestroyed()) window.destroy()
          releaseGuest()
          throw error
        } finally {
          if (pending === reservation) pending = undefined
        }
      },
    }
  }

  const policy = { close, dispose }
  policies.set(owner, policy)
  if (!ownerAlive()) {
    dispose()
    return policy
  }
  contents.setWindowOpenHandler(admit)
  contents.on('did-start-navigation', onOwnerNavigation)
  contents.on('did-finish-load', onOwnerLoaded)
  contents.once('destroyed', dispose)
  contents.on('render-process-gone', close)
  owner.once('closed', dispose)
  return policy
}
