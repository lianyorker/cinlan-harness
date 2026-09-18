/** Local startup UI; product copy arrives only from the shell's typed dictionaries. */
const theme = matchMedia('(prefers-color-scheme: dark)')
const applyTheme = () => { document.body.toggleAttribute('data-ds-dark-theme', theme.matches) }
applyTheme()
theme.addEventListener('change', applyTheme)

const api = window.dshStartup
const title = document.getElementById('startup-title')
const detail = document.getElementById('startup-detail')
const stage = document.getElementById('stage-label')
const failure = document.getElementById('failure')
const errorMessage = document.getElementById('error-message')
const diagnosticLabel = document.getElementById('diagnostic-label')
const diagnosticPath = document.getElementById('diagnostic-path')
const restart = document.getElementById('restart')
const quit = document.getElementById('quit')
const stageKeys = {
  opening: 'startupOpening', recovering: 'startupRecovering', verifying: 'startupVerifying',
  extracting: 'startupExtracting', installing: 'startupInstalling', checking: 'startupChecking',
  cleaning: 'startupCleaning', activating: 'startupActivating', 'starting-host': 'startupHost', 'loading-app': 'startupLoading',
}
let messages
let latest
function render(state) {
  latest = state
  if (messages === undefined) return
  document.body.dataset.phase = state.phase
  document.body.dataset.stage = state.phase === 'starting' ? state.stage : ''
  const failed = state.phase === 'error'
  const stopping = state.phase === 'stopping'
  title.textContent = failed ? messages.startupFailed : stopping ? messages.startupStopping : messages.startupTitle
  document.title = title.textContent
  detail.textContent = failed
    ? state.canRestart ? messages.startupFailureDetail : messages.startupCleanupFailure
    : stopping ? messages.startupStoppingDetail : messages.startupDescription
  stage.textContent = stopping ? messages.startupStopping
    : state.phase === 'starting' ? messages[stageKeys[state.stage]] : ''
  failure.hidden = !failed
  errorMessage.textContent = failed ? state.message : ''
  diagnosticLabel.textContent = failed && state.diagnosticFile === undefined
    ? messages.startupDiagnosticUnavailable : messages.startupDiagnostic
  diagnosticPath.textContent = failed ? state.diagnosticFile ?? '' : ''
  restart.hidden = !failed || !state.canRestart
  restart.disabled = stopping
  quit.disabled = stopping
}
const unsubscribe = api.subscribe(render)
quit.addEventListener('click', () => { void api.quit().catch(error => { console.error(error) }) })
restart.addEventListener('click', () => { void api.restart().catch(error => { console.error(error) }) })
void api.read().then(({ locale, state }) => {
  messages = locale.messages
  document.documentElement.lang = locale.id
  restart.textContent = messages.startupRestart
  quit.textContent = messages.startupQuit
  render(latest ?? state)
})
window.addEventListener('pagehide', () => {
  unsubscribe()
  theme.removeEventListener('change', applyTheme)
}, { once: true })
