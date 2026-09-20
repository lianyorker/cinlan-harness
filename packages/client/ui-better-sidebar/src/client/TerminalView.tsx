/** Integrated xterm renderer over authenticated Remote terminal callbacks. */
import { useEffect, useRef, useState } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import '@xterm/xterm/css/xterm.css'
import { t } from './locales.ts'
import { openWhenSized } from './open-when-sized.ts'
import type { SessionScope, TerminalDepsStatus } from './api.ts'
import type { TerminalCallbacks, SidebarTerminalShell } from '@deepseek-ai/dsh-api-sidebar-terminal-controller/types'
import { rememberTerminalLaunch, type TerminalLaunch } from './terminal-launch.ts'
import chooserCss from './TerminalShellChooser.module.css'
import type { SidebarTerminalAttachmentId, SidebarAgentTerminalId, SidebarTerminalSessionId, SidebarTerminalTabId, SidebarFloatingTerminalDirectory } from '@deepseek-ai/dsh-sidebar-terminals/types'
import { agentUuidOf, isAgentTabId, type SidebarStore } from './state.ts'
import { isDarkScheme, subscribeColorScheme, effectiveTokenValue, tokenValue } from './theme.ts'
import { resolveTerminalOptions } from './terminal-font.ts'
import css from './sidebar.module.css'

/** The degraded-mode payload rendered by {@link TerminalDepsBanner}. */
type TerminalDepsInfo = Extract<TerminalDepsStatus, { ok: false }>

/**
 * Curated ANSI palettes for the terminal. The surface colors (background,
 * foreground, cursor, selection) ride the theme tokens so the terminal
 * blends with the panel in both schemes; the 16 ANSI colors are the same
 * designed palettes the app's code surfaces use (one-dark family for dark,
 * one-light family for light), read live so a scheme flip re-themes in
 * place.
 */
const ANSI_DARK: Record<string, string> = {
  black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
  blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
  brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379',
  brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd',
  brightCyan: '#56b6c2', brightWhite: '#ffffff',
}

const ANSI_LIGHT: Record<string, string> = {
  black: '#383a42', red: '#e45649', green: '#50a14f', yellow: '#c18401',
  blue: '#0184bc', magenta: '#a626a4', cyan: '#0997b3', white: '#a0a1a7',
  brightBlack: '#4f525e', brightRed: '#e45649', brightGreen: '#50a14f',
  brightYellow: '#c18401', brightBlue: '#0184bc', brightMagenta: '#a626a4',
  brightCyan: '#0997b3', brightWhite: '#fafafa',
}

/** The xterm theme for the current scheme (surface from tokens, ANSI curated). */
function xtermTheme(): ITheme {
  const dark = isDarkScheme()
  // Skin systems set --dsw-alias-bg-base to `transparent` or translucent
  // glass values (the dsh-web-ui skins use rgba 0.16–0.7); effectiveTokenValue
  // treats those as unset below the opacity floor, so the opaque fallback
  // engages and the terminal never renders see-through over the skin's
  // backdrop (issue #90). Effectively opaque scoped surfaces (e.g. a skin's
  // 0.96 porcelain) pass through — the skin still controls the terminal.
  const background = effectiveTokenValue('--dsw-alias-bg-base') || (dark ? '#111114' : '#ffffff')
  const foreground = effectiveTokenValue('--dsw-alias-label-primary') || (dark ? '#e6e6e6' : '#1a1a1a')
  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: dark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.12)',
    ...(dark ? ANSI_DARK : ANSI_LIGHT),
  }
}

/** Renderer input; transport behavior comes from the plugin's apply closure. */
export type TerminalViewProps = {
  scope: SessionScope
  tabId: string
  store: SidebarStore
  floating?: SidebarFloatingTerminalDirectory
  launch?: TerminalLaunch
}
  & Pick<TerminalCallbacks, 'connectTerminal' | 'terminalInput' | 'terminalResize' | 'terminalShells'>

/** @param props - persisted tab state and terminal callbacks. @returns a shell chooser or the attached renderer. */
export function TerminalView(props: TerminalViewProps) {
  return <TerminalTab key={JSON.stringify([props.scope.sessionId, props.tabId])} {...props} />
}

function TerminalTab(props: TerminalViewProps) {
  const [launch, setLaunch] = useState<TerminalLaunch>(() => props.launch ?? { pending: false })
  if (launch.pending && !isAgentTabId(props.tabId)) {
    return <TerminalShellChooser load={props.terminalShells} onLaunch={(shellPath) => {
      setLaunch({ pending: false, ...shellPath === undefined ? {} : { shellPath } })
    }} />
  }
  return <ConnectedTerminal {...props} launch={launch} />
}

function TerminalShellChooser({ load, onLaunch }: {
  load: TerminalCallbacks['terminalShells']
  onLaunch: (path?: string) => void
}) {
  const [shells, setShells] = useState<readonly SidebarTerminalShell[]>([])
  const [path, setPath] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let closed = false
    setStatus('loading')
    void load().then((value) => {
      if (!closed) { setShells(value); setStatus('ready') }
    }, () => { if (!closed) setStatus('failed') })
    return () => { closed = true }
  }, [load, attempt])
  return <div className={chooserCss.chooser}>
    <label className={chooserCss.label}>
      {t('terminalShellLabel')}
      <select className={chooserCss.select} value={path} onChange={(event) => { setPath(event.target.value) }}>
        <option value="">{t('terminalShellDefault')}</option>
        {shells.map(shell => <option key={shell.path} value={shell.path}>{shell.name}</option>)}
      </select>
    </label>
    {status === 'loading' && <div role="status">{t('terminalShellLoading')}</div>}
    {status === 'failed' && <div role="alert">
      {t('terminalShellLoadFailed')}
      <button type="button" className={css.terminalRetry} onClick={() => { setAttempt(value => value + 1) }}>{t('terminalRetry')}</button>
    </div>}
    <button type="button" className={css.terminalRetry} onClick={() => { onLaunch(path === '' ? undefined : path) }}>{t('terminalShellStart')}</button>
  </div>
}

function ConnectedTerminal(props: TerminalViewProps & { launch: TerminalLaunch }) {
  const { scope, tabId, store, floating, launch, connectTerminal, terminalInput, terminalResize } = props
  const shellPath = launch.shellPath
  const floatingWindowId = floating?.windowId
  const floatingDirectory = floating?.directory
  const hostRef = useRef<HTMLDivElement>(null)
  const [connected, setConnected] = useState(false)
  const [fatal, setFatal] = useState<string | null>(null)
  const connectRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const term = new Terminal({
      ...resolveTerminalOptions(store.getPrefs(), tokenValue('--ds-font-family-code')),
      allowTransparency: true,
      convertEol: false,
      theme: xtermTheme(),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    // Re-theme in place when the app's scheme flips (tokens + palette).
    const applyTheme = (): void => {
      term.options.theme = xtermTheme()
      term.refresh(0, term.rows - 1)
    }
    const schemeSub = subscribeColorScheme(applyTheme)

    let closed = false
    let attachmentId: SidebarTerminalAttachmentId | undefined
    let disconnect: ReturnType<TerminalCallbacks['connectTerminal']> | undefined
    const writes = new Set<() => void>()
    const report = (error: unknown): void => {
      if (closed) return
      setConnected(false)
      const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined
      setFatal(code === 'sidebarTerminals/invalid-directory' ? t('terminalDirectoryError')
        : code === 'sidebarTerminals/unavailable' ? t('terminalDepsFailed')
          : code === 'sidebarTerminals/invalid-shell' ? t('terminalShellUnavailable') : t('terminalConnectFailed'))
    }
    const sendResize = (): void => {
      if (attachmentId !== undefined) void terminalResize(attachmentId, term.cols, term.rows).catch(report)
    }
    const connect = (): void => {
      if (closed) return
      void disconnect?.('disconnect').catch(report)
      attachmentId = undefined
      const target = isAgentTabId(tabId)
        ? { kind: 'agent' as const, uuid: agentUuidOf(tabId) as SidebarAgentTerminalId }
        : { kind: 'ui' as const, sessionId: scope.sessionId as SidebarTerminalSessionId, tabId: tabId as SidebarTerminalTabId, ...(shellPath === undefined ? {} : { shellPath }), ...(floatingWindowId === undefined || floatingDirectory === undefined ? {} : { floating: { windowId: floatingWindowId, directory: floatingDirectory } }) }
      disconnect = connectTerminal({ target, cols: term.cols, rows: term.rows }, async (frame) => {
        if (closed) return
        if (frame.type === 'ready') {
          attachmentId = frame.attachmentId
          if (!isAgentTabId(tabId)) rememberTerminalLaunch(store, scope.sessionId, tabId,
            { pending: false, ...shellPath === undefined ? {} : { shellPath } }, frame.shellName)
          term.reset()
          Object.assign(term.options, resolveTerminalOptions(store.getPrefs(), tokenValue('--ds-font-family-code')))
          setConnected(true)
          setFatal(null)
          sendResize()
        } else if (frame.type === 'data') {
          await new Promise<void>((resolve) => {
            const done = (): void => { writes.delete(done); resolve() }
            writes.add(done)
            term.write(frame.data, done)
          })
        } else {
          attachmentId = undefined
          setConnected(false)
          term.write('\r\n' + t('terminalProcessExited', { code: String(frame.exitCode) }) + '\r\n')
        }
      }, report)
    }
    connectRef.current = connect
    const inputSub = term.onData((data) => {
      if (attachmentId !== undefined) void terminalInput(attachmentId, data).catch(report)
    })
    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
        sendResize()
      } catch {
        // The terminal may be mid-dispose; ignore.
      }
    })
    observer.observe(host)

    // Renderer preferences update the existing xterm instance; font changes also resize its grid.
    const fontSub = store.subscribe(() => {
      const next = resolveTerminalOptions(store.getPrefs(), tokenValue('--ds-font-family-code'))
      if (next.scrollback !== term.options.scrollback) term.options.scrollback = next.scrollback
      if (next.cursorStyle !== term.options.cursorStyle) term.options.cursorStyle = next.cursorStyle
      if (next.cursorBlink !== term.options.cursorBlink) term.options.cursorBlink = next.cursorBlink
      if (next.fontFamily !== term.options.fontFamily || next.fontSize !== term.options.fontSize) {
        term.options.fontFamily = next.fontFamily
        term.options.fontSize = next.fontSize
        try {
          fit.fit()
          sendResize()
        } catch {
          // The terminal may be mid-dispose; ignore.
        }
      }
    })

    // The terminal must not be opened in a zero-size container: xterm's
    // renderer creation fails there and the next Viewport refresh crashes
    // reading `.dimensions` off the undefined renderer (blank terminal on
    // WKWebView when the bottom panel's expand slide leaves the host at
    // height 0; any display:none-hidden ancestor does the same). Defer
    // open+fit until the host has a real size — writes arriving meanwhile
    // are buffered by xterm's WriteBuffer and render once open, and
    // FitAddon.fit() is a safe no-op before open. sendResize() here covers
    // the deferred path where the socket may already be open with the
    // default 80x24 dims.
    const cancelOpen = openWhenSized(host, () => {
      try {
        term.open(host)
        fit.fit()
        sendResize()
      } catch (error) {
        console.error('[dsh-better-sidebar] xterm open failed:', error)
      }
    })

    connect()
    return () => {
      closed = true
      cancelOpen()
      observer.disconnect()
      fontSub()
      schemeSub()
      inputSub.dispose()
      const tabStillOpen = store.tabOpen(scope.sessionId, tabId)
      const sessionSwitched = store.getSnapshot().sessionId !== scope.sessionId
      const mode = !tabStillOpen ? 'close' : sessionSwitched && !isAgentTabId(tabId) ? 'park' : 'disconnect'
      for (const done of writes) done()
      void disconnect?.(mode).catch(() => { /* A lost carrier applies the Host's disconnect policy. */ })
      term.dispose()
      connectRef.current = null
    }
  }, [scope.sessionId, tabId, store, floatingWindowId, floatingDirectory, shellPath, connectTerminal, terminalInput, terminalResize])

  return (
    <div className={css.terminalWrap} data-dsh-terminal-tab={tabId}>
      {fatal !== null && (
        <div className={css.terminalBanner}>
          {t('terminalError')}: {fatal}
          <button
            type="button"
            className={css.terminalRetry}
            onClick={() => { setFatal(null); connectRef.current?.() }}
          >
            {t('terminalRetry')}
          </button>
        </div>
      )}
      {fatal === null && !connected && <div className={css.terminalBanner}>{t('disconnected')}</div>}
      <div ref={hostRef} className={css.terminal} />
    </div>
  )
}

/**
 * The node-pty dependency failure banner (issue #140): explains that the
 * terminal's native dependency failed to load and shows the PASTEABLE repair
 * command (bash / cmd / PowerShell) with a copy button — the user pastes it
 * into a terminal where their DSH profile lives and runs it, then retries.
 * Extracted as a standalone component for direct testing.
 */
export function TerminalDepsBanner(props: { deps: TerminalDepsInfo; onRetry: () => void }) {
  const { deps, onRetry } = props
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    const written = await writeClipboard(deps.command)
    if (written) {
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 2000)
    }
  }
  return (
    <div className={css.terminalDepsBanner}>
      <div className={css.terminalDepsTitle}>{t('terminalDepsFailed')}</div>
      <div className={css.terminalDepsHint}>
        {t('terminalDepsHint')}
        {deps.profile !== null ? t('terminalDepsProfile', { profile: deps.profile }) : ''}
      </div>
      <div className={css.terminalDepsCommandRow}>
        <pre className={css.terminalRepairCommand}>{deps.command}</pre>
        <button type="button" className={css.terminalRetry} onClick={() => { void copy() }} aria-label={t('copy')}>
          {copied ? t('copied') : t('copy')}
        </button>
      </div>
      {deps.note !== undefined && <div className={css.terminalDepsNote}>{deps.note}</div>}
      <div className={css.terminalDepsActions}>
        <button type="button" className={css.terminalRetry} onClick={onRetry}>
          {t('terminalRetry')}
        </button>
      </div>
    </div>
  )
}
