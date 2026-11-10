// @vitest-environment jsdom
/** Live terminal preferences update renderer options without replacing the connected process. */
import { act, cleanup, render, screen } from '@testing-library/react'
import type { TerminalCallbacks } from '@deepseek-ai/dsh-api-sidebar-terminal-controller/types'
import type { SidebarTerminalFrame, SidebarTerminalAttachmentId, SidebarTerminalProcessId } from '@deepseek-ai/dsh-sidebar-terminals/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ITerminalOptions } from '@xterm/xterm'
import { SIDEBAR_PREFS_DEFAULTS } from '../src/prefs-shared.ts'
import { parsePrefs } from '../src/client/prefs.ts'
import { SidebarStore } from '../src/client/state.ts'
import { TerminalView } from '../src/client/TerminalView.tsx'

type MockTerminal = {
  options: ITerminalOptions
  dispose: ReturnType<typeof vi.fn>
  paste: ReturnType<typeof vi.fn>
  getSelection: ReturnType<typeof vi.fn>
  selectionListener?: () => void
  onSelectionChange: ReturnType<typeof vi.fn>
  oscHandler?: (data: string) => boolean
  parser: { registerOscHandler: ReturnType<typeof vi.fn> }
  loadAddon: ReturnType<typeof vi.fn>
}

const state = vi.hoisted(() => ({ terminals: [] as MockTerminal[] }))
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  cols = 80
  rows = 24
  dispose = vi.fn()
  paste = vi.fn()
  getSelection = vi.fn(() => '')
  selectionListener: (() => void) | undefined
  onSelectionChange = vi.fn((listener: () => void) => {
    this.selectionListener = listener
    return { dispose: vi.fn() }
  })
  parser = { registerOscHandler: vi.fn((_code: number, handler: (data: string) => boolean) => {
    this.oscHandler = handler
    return { dispose: vi.fn() }
  }) }
  constructor(public options: ITerminalOptions) { state.terminals.push(this) }
  loadAddon = vi.fn()
  onData() { return { dispose() {} } }
  refresh() {}
  open() {}
  write(_data: string, done?: () => void) { done?.() }
  reset() {}
  focus = vi.fn()
} }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))

function transport() {
  const disconnect = vi.fn(async () => {})
  const connectTerminal = vi.fn<TerminalCallbacks['connectTerminal']>(() => disconnect)
  const terminalInput = vi.fn<TerminalCallbacks['terminalInput']>(async () => {})
  const terminalResize = vi.fn<TerminalCallbacks['terminalResize']>(async () => {})
  const terminalShells = vi.fn<TerminalCallbacks['terminalShells']>(async () => [])
  return { connectTerminal, terminalInput, terminalResize, terminalShells, disconnect }
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
        terminalScrollback: 8500, terminalScrollSensitivity: 4, terminalFastScrollSensitivity: 9, terminalCursorStyle: 'bar', terminalCursorBlink: false, terminalWordSeparator: ' ()[]' }))
    })
    expect(terminal.options).toMatchObject({ fontFamily: 'Example Mono', fontSize: 18, scrollback: 8500, scrollSensitivity: 4, fastScrollSensitivity: 9, fastScrollModifier: 'alt', cursorBlink: false, cursorStyle: 'bar', wordSeparator: ' ()[]' })
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

  it('pastes on unmodified right-click and preserves the native menu for Ctrl or Command', async () => {
    const readText = vi.fn(async () => 'clipboard text')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } })
    const store = new SidebarStore()
    store.setPrefs({ ...SIDEBAR_PREFS_DEFAULTS, terminalRightClickPaste: true })
    const view = render(<TerminalView scope={{ sessionId: 'paste-session' }} tabId="terminal:0" store={store} {...transport()} />)
    const host = view.container.querySelector('[data-dsh-terminal-tab="terminal:0"] > div:last-child')!
    const plain = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    host.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(true)
    await vi.waitFor(() => { expect(state.terminals[0].paste).toHaveBeenCalledWith('clipboard text') })
    for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
      const escaped = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...modifiers })
      host.dispatchEvent(escaped)
      expect(escaped.defaultPrevented).toBe(false)
    }
    expect(readText).toHaveBeenCalledOnce()
    view.unmount()
    const afterDispose = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    host.dispatchEvent(afterDispose)
    expect(readText).toHaveBeenCalledOnce()
  })

  it('leaves the native menu when right-click paste is disabled or clipboard reads are unavailable', () => {
    const store = new SidebarStore()
    const view = render(<TerminalView scope={{ sessionId: 'paste-disabled' }} tabId="terminal:0" store={store} {...transport()} />)
    const host = view.container.querySelector('[data-dsh-terminal-tab="terminal:0"] > div:last-child')!
    const disabled = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    host.dispatchEvent(disabled)
    expect(disabled.defaultPrevented).toBe(false)
    store.setPrefs({ ...SIDEBAR_PREFS_DEFAULTS, terminalRightClickPaste: true })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    const unavailable = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    host.dispatchEvent(unavailable)
    expect(unavailable.defaultPrevented).toBe(false)
  })

  it('copies non-empty selections only when enabled and removes the listener on disposal', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const store = new SidebarStore()
    const view = render(<TerminalView scope={{ sessionId: 'copy-session' }} tabId="terminal:0" store={store} {...transport()} />)
    const terminal = state.terminals[0]!
    terminal.getSelection.mockReturnValue('selected text')
    terminal.selectionListener?.()
    expect(writeText).not.toHaveBeenCalled()
    store.setPrefs({ ...SIDEBAR_PREFS_DEFAULTS, terminalCopyOnSelect: true })
    terminal.selectionListener?.()
    await vi.waitFor(() => { expect(writeText).toHaveBeenCalledWith('selected text') })
    terminal.getSelection.mockReturnValue('')
    terminal.selectionListener?.()
    expect(writeText).toHaveBeenCalledOnce()
    view.unmount()
    expect(terminal.onSelectionChange.mock.results[0]?.value.dispose).toHaveBeenCalledOnce()
  })

  it('focuses on pointer entry only while enabled and removes the handler on disposal', () => {
    const store = new SidebarStore()
    const view = render(<TerminalView scope={{ sessionId: 'focus-session' }} tabId="terminal:0" store={store} {...transport()} />)
    const host = view.container.querySelector('[data-dsh-terminal-tab="terminal:0"] > div:last-child')!
    const terminal = state.terminals[0]!
    host.dispatchEvent(new MouseEvent('mouseenter'))
    expect(terminal.focus).not.toHaveBeenCalled()
    act(() => { store.setPrefs({ ...SIDEBAR_PREFS_DEFAULTS, terminalFocusFollowsMouse: true }) })
    host.dispatchEvent(new MouseEvent('mouseenter'))
    expect(terminal.focus).toHaveBeenCalledOnce()
    act(() => { store.setPrefs({ ...SIDEBAR_PREFS_DEFAULTS, terminalFocusFollowsMouse: false }) })
    host.dispatchEvent(new MouseEvent('mouseenter'))
    expect(terminal.focus).toHaveBeenCalledOnce()
    view.unmount()
    host.dispatchEvent(new MouseEvent('mouseenter'))
    expect(terminal.focus).toHaveBeenCalledOnce()
  })

  it('consumes OSC 52, writes only allowed clipboard selectors, and disposes its handler', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const store = new SidebarStore()
    const view = render(<TerminalView scope={{ sessionId: 'osc52-session' }} tabId="terminal:0" store={store} {...transport()} />)
    const terminal = state.terminals[0]!
    const handler = terminal.oscHandler!
    expect(terminal.parser.registerOscHandler).toHaveBeenCalledWith(52, expect.any(Function))
    expect(handler('unknown;YQ==')).toBe(true)
    expect(writeText).not.toHaveBeenCalled()
    act(() => { store.setPrefs({ ...SIDEBAR_PREFS_DEFAULTS, terminalAllowOsc52: true }) })
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode('日本')))
    expect(handler(`c;${encoded}`)).toBe(true)
    await vi.waitFor(() => { expect(writeText).toHaveBeenCalledWith('日本') })
    const invalidUtf8 = btoa(String.fromCharCode(0xff))
    const oversized = btoa('x'.repeat(1024 * 1024 + 1))
    for (const invalid of ['unknown;YQ==', 'c;?', 'c;%%%= ', `c;${invalidUtf8}`, `c;${oversized}`]) expect(handler(invalid)).toBe(true)
    expect(writeText).toHaveBeenCalledOnce()
    view.unmount()
    expect(terminal.parser.registerOscHandler.mock.results[0]?.value.dispose).toHaveBeenCalledOnce()
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
