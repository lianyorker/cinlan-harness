/** Browser/native WindowProxy adapter; native policy admits the same artifact route. */
import { floatingRoute, floatingUrl } from './window-route.ts'
import type { FloatingWorkspaceWindowId } from '@deepseek-ai/dsh-sidebar-terminals/types'

/** Exact window identity retained by one runtime controller. */
export interface OwnedAppWindow {
  readonly closed: boolean
  /** Close only this exact app window. */
  close(): void
}

/** Environmental operations, kept out of render props and deterministic runtime tests. */
export interface FloatingWindowEnvironment {
  readonly child: boolean
  readonly supported: boolean
  readonly initialSession?: string
  /** @returns validated child identity before preferences load, or undefined without a live opener. */
  readWindowId(): FloatingWorkspaceWindowId | undefined
  /**
   * Open the same app artifact synchronously.
   * @param width - requested initial width in pixels.
   * @param height - requested initial height in pixels.
   * @returns the exact created window, or null when the browser blocks it.
   */
  open(width: number, height: number): OwnedAppWindow | null
  /** Close this renderer only when it is an actual app-owned child. */
  closeSelf(): void
  /** @returns a callback restoring the still-connected originating control on its live page. */
  captureFocus(): () => void
  /**
   * Observe this window's external closure.
   * @param target - exact owned WindowProxy.
   * @param closed - callback after observing its closed state.
   * @returns a disposer removing the observer and timer.
   */
  observeClosed(target: OwnedAppWindow, closed: () => void): () => void
  /**
   * Observe this source document's exit.
   * @param close - callback releasing the owned child.
   * @returns a disposer removing the exit listener.
   */
  onPageExit(close: () => void): () => void
}

/**
 * Bind app-window operations to one actual document and its live opener.
 * @param page - renderer window owning this activation.
 * @param readSession - current listed Session id at the user gesture.
 * @param checkIntervalMs - deployment-configured closed-window observation cadence.
 * @returns an owner-local adapter with no credentials in its URLs or messages.
 */
export function browserWindowEnvironment(
  page: Window, readSession: () => string | undefined, checkIntervalMs: number,
): FloatingWindowEnvironment {
  const url = new URL(page.location.href)
  const route = floatingRoute(url)
  const child = url.searchParams.has('dsh-floating-workspace')
  const owner = child ? route?.owner : typeof page.crypto.randomUUID === 'function' ? page.crypto.randomUUID() : undefined
  const liveOpener = () => page.opener !== null && !(page.opener as Window).closed
  const supported = owner !== undefined && ['http:', 'https:', 'dsh-app:'].includes(url.protocol)
    && (!child || (route !== undefined && page.name === 'dsh-floating-workspace-' + route.owner && liveOpener()))
  return {
    child, supported,
    ...(route?.session === undefined ? {} : { initialSession: route.session }),
    readWindowId: () => supported && child && liveOpener() ? route?.owner : undefined,
    open(width, height) {
      if (!supported || child) return null
      const target = page.open(floatingUrl(url, owner, readSession()).href, 'dsh-floating-workspace-' + owner,
        'popup=yes,width=' + String(width) + ',height=' + String(height))
      if (target === null && url.protocol === 'dsh-app:') throw new Error('Native app window was not admitted')
      return target
    },
    closeSelf() {
      // Only an actual app-owned child can close itself; direct route visits have no opener authority.
      if (!child || !supported || page.opener === null) return
      const opener = page.opener as Window
      if (!opener.closed) opener.focus()
      page.close()
    },
    captureFocus() {
      const active = page.document.activeElement
      return () => {
        if (page.closed) return
        page.focus()
        if (active instanceof HTMLElement && active.isConnected) active.focus({ preventScroll: true })
      }
    },
    observeClosed(target, closed) {
      const check = () => { if (target.closed) closed() }
      const timer = page.setInterval(check, checkIntervalMs)
      page.addEventListener('focus', check)
      return () => { page.clearInterval(timer); page.removeEventListener('focus', check) }
    },
    onPageExit(close) {
      page.addEventListener('pagehide', close)
      return () => { page.removeEventListener('pagehide', close) }
    },
  }
}
