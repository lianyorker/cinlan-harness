/** Shared application loading view with Desktop-only failure actions and diagnostics. */
import { BootPage } from '@deepseek-ai/dsh-client-web/boot-page'
import type { DesktopStartupApi } from './ipc.ts'
import type { DesktopMessages } from './locale.ts'
import type { DesktopStartupState } from './startup.ts'

function element(id: string): HTMLElement {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`Desktop loading document is missing #${id}`)
  return node
}

/**
 * Keep the application's loading view visible throughout Desktop preparation.
 * @param container - Loading mount point beside the hidden failure panel.
 * @param api - Origin-restricted Desktop lifecycle bridge.
 * @returns Disposer for the page, theme listener, and lifecycle subscription.
 */
export function mountDesktopLoading(container: HTMLElement, api: DesktopStartupApi): () => void {
  const page = new BootPage(container)
  const theme = matchMedia('(prefers-color-scheme: dark)')
  const applyTheme = (): void => { document.body.toggleAttribute('data-ds-dark-theme', theme.matches) }
  applyTheme()
  theme.addEventListener('change', applyTheme)
  const failure = element('failure')
  const title = element('startup-title')
  const detail = element('startup-detail')
  const errorMessage = element('error-message')
  const diagnosticLabel = element('diagnostic-label')
  const diagnosticPath = element('diagnostic-path')
  const restart = element('restart') as HTMLButtonElement
  const quit = element('quit') as HTMLButtonElement
  let messages: DesktopMessages | undefined
  let latest: DesktopStartupState | undefined
  let disposed = false
  const render = (state: DesktopStartupState): void => {
    if (disposed) return
    latest = state
    document.body.dataset.phase = state.phase
    document.body.dataset.stage = state.phase === 'starting' ? state.stage : ''
    if (messages === undefined) return
    if (state.phase === 'error') {
      page.dispose()
      container.hidden = true
      failure.hidden = false
      title.textContent = messages.startupFailed
      document.title = messages.startupFailed
      detail.textContent = state.canRestart ? messages.startupFailureDetail : messages.startupCleanupFailure
      errorMessage.textContent = state.message
      diagnosticLabel.textContent = state.diagnosticFile === undefined ? messages.startupDiagnosticUnavailable : messages.startupDiagnostic
      diagnosticPath.textContent = state.diagnosticFile ?? ''
      restart.hidden = !state.canRestart
    } else if (state.phase === 'stopping') {
      document.title = messages.startupStopping
      title.textContent = messages.startupStopping
      detail.textContent = messages.startupStoppingDetail
      restart.hidden = true
    }
    restart.disabled = state.phase === 'stopping'
    quit.disabled = state.phase === 'stopping'
  }
  const unsubscribe = api.subscribe(render)
  const quitApplication = (): void => { void api.quit().catch((error: unknown) => { console.error(error) }) }
  const restartApplication = (): void => { void api.restart().catch((error: unknown) => { console.error(error) }) }
  quit.addEventListener('click', quitApplication)
  restart.addEventListener('click', restartApplication)
  void api.read().then(({ locale, state }) => {
    if (disposed) return
    messages = locale.messages
    document.documentElement.lang = locale.id
    restart.textContent = messages.startupRestart
    quit.textContent = messages.startupQuit
    render(latest ?? state)
  }).catch((error: unknown) => { console.error(error) })
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    unsubscribe()
    page.dispose()
    theme.removeEventListener('change', applyTheme)
    quit.removeEventListener('click', quitApplication)
    restart.removeEventListener('click', restartApplication)
    window.removeEventListener('pagehide', dispose)
  }
  window.addEventListener('pagehide', dispose, { once: true })
  return dispose
}
