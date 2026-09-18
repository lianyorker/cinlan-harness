// @vitest-environment jsdom
/** Live terminal preferences update renderer options without replacing the connected process. */
import { act, cleanup, render, screen } from '@testing-library/react'
import type { TerminalCallbacks } from '../src/client/terminal-transport.ts'
import type { SidebarTerminalFrame, SidebarTerminalAttachmentId, SidebarTerminalProcessId } from '@deepseek-ai/dsh-sidebar-terminals/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ITerminalOptions } from '@xterm/xterm'
import { SIDEBAR_PREFS_DEFAULTS } from '../src/prefs-shared.ts'
import { parsePrefs } from '../src/client/prefs.ts'
import { SidebarStore } from '../src/client/state.ts'
import { TerminalView } from '../src/client/TerminalView.tsx'

const state = vi.hoisted(() => ({ terminals: [] as { options: ITerminalOptions; dispose: ReturnType<typeof vi.fn> }[] }))
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  cols = 80
  rows = 24
  dispose = vi.fn()
  constructor(public options: ITerminalOptions) { state.terminals.push(this) }
  loadAddon() {}
  onData() { return { dispose() {} } }
  refresh() {}
  open() {}
  write(_data: string, done?: () => void) { done?.() }
  reset() {}
  focus() {}
} }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))

function transport() {
  const disconnect = vi.fn(async () => {})
  const connectTerminal = vi.fn<TerminalCallbacks['connectTerminal']>(() => disconnect)
  const terminalInput = vi.fn<TerminalCallbacks['terminalInput']>(async () => {})
  const terminalResize = vi.fn<TerminalCallbacks['terminalResize']>(async () => {})
  return { connectTerminal, terminalInput, terminalResize, disconnect }
}

beforeEach(() => {
  state.terminals.length = 0
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('integrated terminal rendering preferences', () => {
  it('parses renderer options and applies them to the current xterm without opening another Remote attachment', () => {
    const store = new SidebarStore()
    const connection = transport()
    const view = render(<TerminalView scope={{ sessionId: 'rendering-session' }} tabId="terminal:0" store={store} {...connection} />)
    const terminal = state.terminals[0]
    expect(terminal.options).toMatchObject({ scrollback: 4000, cursorBlink: true, cursorStyle: 'block', fontSize: 13 })
    act(() => {
      store.setPrefs(parsePrefs({ ...SIDEBAR_PREFS_DEFAULTS, terminalFontFamily: 'Example Mono', terminalFontSize: 18,
        terminalScrollback: 8500, terminalCursorStyle: 'bar', terminalCursorBlink: false }))
    })
    expect(terminal.options).toMatchObject({ fontFamily: 'Example Mono', fontSize: 18, scrollback: 8500, cursorBlink: false, cursorStyle: 'bar' })
    expect(state.terminals).toHaveLength(1)
    expect(connection.connectTerminal).toHaveBeenCalledOnce()
    expect(terminal.dispose).not.toHaveBeenCalled()
    expect(connection.disconnect).not.toHaveBeenCalled()
    view.unmount()
    expect(terminal.dispose).toHaveBeenCalledOnce()
    expect(connection.disconnect).toHaveBeenCalledOnce()
  })

  it('keeps shell preferences and client cwd out of the existing authenticated attachment', () => {
    const store = new SidebarStore()
    const connection = transport()
    render(<TerminalView scope={{ sessionId: 'launch-session', cwd: '/workspace' }} tabId="terminal:0" store={store} {...connection} />)
    act(() => { store.setPrefs({ ...SIDEBAR_PREFS_DEFAULTS, terminalShell: '/new/shell', terminalShellArgs: '--login' }) })
    expect(state.terminals).toHaveLength(1)
    expect(connection.connectTerminal).toHaveBeenCalledOnce()
    expect(connection.connectTerminal.mock.calls[0][0]).toEqual({ target: { kind: 'ui', sessionId: 'launch-session', tabId: 'terminal:0' }, cols: 80, rows: 24 })
  })

  it('shows the directory correction without replacing the captured input', async () => {
    const store = new SidebarStore()
    const connection = transport()
    const captured = { windowId: '11111111-1111-4111-8111-111111111111' as never, directory: '../outside' }
    const view = render(<TerminalView scope={{ sessionId: 'scope-session' }} tabId="terminal:11111111-1111-4111-8111-111111111111:0" store={store} floating={captured} {...connection} />)
    act(() => { connection.connectTerminal.mock.calls[0][2]({ code: 'sidebarTerminals/invalid-directory' }) })
    expect(view.container.textContent).toContain('Choose an existing folder inside this session workspace.')
    expect(connection.connectTerminal.mock.calls[0][0].target).toMatchObject({ floating: captured })
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined()
  })

  it('writes ready, output, and exit through the injected stream callbacks', async () => {
    const connection = transport()
    render(<TerminalView scope={{ sessionId: 'stream-session' }} tabId="terminal:0" store={new SidebarStore()} {...connection} />)
    const sink = connection.connectTerminal.mock.calls[0][1]
    const attachmentId = '11111111-1111-4111-8111-111111111111' as SidebarTerminalAttachmentId
    const frames: SidebarTerminalFrame[] = [
      { type: 'ready', attachmentId, processId: '87654321-4321-4321-8321-cba987654321' as SidebarTerminalProcessId, pid: 3, cwd: '/workspace', shellName: 'sh' },
      { type: 'data', attachmentId, sequence: 1, data: 'rendered output' },
      { type: 'exit', attachmentId, exitCode: 0 },
    ]
    await act(async () => { for (const frame of frames) await sink(frame) })
    expect(connection.terminalResize).toHaveBeenCalledWith(attachmentId, 80, 24)
    expect(connection.connectTerminal).toHaveBeenCalledOnce()
  })

  it('uses options accepted by the installed xterm runtime, including live setters', async () => {
    // No canvas is opened in this option-setter check; xterm's module probe can use its null fallback.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const real = await vi.importActual<typeof import('@xterm/xterm')>('@xterm/xterm')
    const terminal = new real.Terminal({ scrollback: 4000, cursorStyle: 'block', cursorBlink: true })
    try {
      terminal.options.scrollback = 0
      terminal.options.cursorStyle = 'underline'
      terminal.options.cursorBlink = false
      terminal.options.fontSize = 32
      expect(terminal.options).toMatchObject({ scrollback: 0, cursorStyle: 'underline', cursorBlink: false, fontSize: 32 })
    } finally { terminal.dispose() }
  })
})
