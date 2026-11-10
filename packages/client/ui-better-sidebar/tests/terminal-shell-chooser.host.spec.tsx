// @vitest-environment jsdom
/** User launch choices persist with each tab; mocked native rendering keeps these tests keyless. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalCallbacks, SidebarTerminalFrame } from '@deepseek-ai/dsh-api-sidebar-terminal-controller/types'
import { allLeaves, createTerminalTab, openTabInActivePane, SidebarStore, type SidebarTab } from '../src/client/state.ts'
import { terminalLaunchOf } from '../src/client/terminal-launch.ts'
import { TerminalView } from '../src/client/TerminalView.tsx'

vi.mock('@xterm/xterm', () => ({ Terminal: class {
  cols = 80
  rows = 24
  constructor(public options: object) {}
  loadAddon() {}
  onData() { return { dispose() {} } }
  refresh() {}
  open() {}
  write(_data: string, done?: () => void) { done?.() }
  reset() {}
  dispose() {}
} }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))

const sessionId = 'shell-choice-session'
function tabs(store: SidebarStore): SidebarTab[] {
  const state = store.getSnapshot().state!
  return [...allLeaves(state.splits), ...allLeaves(state.bottomSplits)].flatMap(leaf => leaf.tabs)
}
function createTab(store: SidebarStore): SidebarTab {
  let tab!: SidebarTab
  store.reduce((state) => {
    const created = createTerminalTab(state, 'Terminal')!
    tab = created.tab
    return openTabInActivePane({ ...state, ...created.patch }, tab)
  })
  return tab
}
function callbacks() {
  return {
    connectTerminal: vi.fn<TerminalCallbacks['connectTerminal']>(() => vi.fn(async () => {})),
    terminalInput: vi.fn<TerminalCallbacks['terminalInput']>(async () => {}),
    terminalResize: vi.fn<TerminalCallbacks['terminalResize']>(async () => {}),
    terminalShells: vi.fn<TerminalCallbacks['terminalShells']>(async () => [
      { path: '/bin/bash', name: 'bash' }, { path: '/bin/zsh', name: 'zsh' },
    ]),
  }
}
function connectCall(connection: ReturnType<typeof callbacks>, index: number) {
  const call = connection.connectTerminal.mock.calls[index]
  if (call === undefined) throw new Error(`Missing terminal connection call at index ${index}`)
  return call
}
async function ready(connection: ReturnType<typeof callbacks>, index: number, name: string) {
  await act(async () => { await connectCall(connection, index)[1]({
    type: 'ready', attachmentId: 'attachment', processId: 'process', pid: 1, cwd: '/workspace', shellName: name,
  } as SidebarTerminalFrame) })
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => {
  cleanup()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('terminal tab shell chooser', () => {
  it('chooses a shell per tab, preserves Settings, and reconnects saved tabs without a second chooser', async () => {
    const store = new SidebarStore()
    store.setSession(sessionId)
    store.setPrefs({ ...store.getPrefs(), terminalShell: '/settings/shell', terminalShellArgs: '--settings' })
    const first = createTab(store)
    const second = createTab(store)
    const connection = callbacks()
    const view = render(<TerminalView scope={{ sessionId }} store={store} tabId={first.id}
      launch={terminalLaunchOf(first)} {...connection} />)
    await act(async () => {})
    expect(connection.connectTerminal).not.toHaveBeenCalled()
    expect(screen.getByRole('combobox').textContent).toBe('Use default shellbashzsh')
    expect(connection.terminalShells).toHaveBeenCalledWith(sessionId)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '/bin/zsh' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start terminal' }))
    expect(connectCall(connection, 0)[0].target).toMatchObject({ tabId: first.id, shellPath: '/bin/zsh' })
    await ready(connection, 0, 'zsh')
    expect(tabs(store).find(tab => tab.id === first.id)).toMatchObject({ title: 'zsh', meta: { terminalLaunch: { pending: false, shellPath: '/bin/zsh' } } })
    view.rerender(<TerminalView scope={{ sessionId }} store={store} tabId={second.id} launch={terminalLaunchOf(second)} {...connection} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Start terminal' }))
    expect(connectCall(connection, 1)[0].target).not.toHaveProperty('shellPath')
    await ready(connection, 1, 'settings-shell')
    expect(store.getPrefs()).toMatchObject({ terminalShell: '/settings/shell', terminalShellArgs: '--settings' })
    await vi.runAllTimersAsync()
    view.unmount()
    const restored = new SidebarStore()
    restored.setSession(sessionId)
    const saved = tabs(restored).find(tab => tab.id === first.id)!
    render(<TerminalView scope={{ sessionId }} store={restored} tabId={saved.id} launch={terminalLaunchOf(saved)} {...connection} />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(connection.terminalShells).toHaveBeenCalledTimes(2)
    expect(connectCall(connection, 2)[0].target).toMatchObject({ tabId: first.id, shellPath: '/bin/zsh' })
  })

  it('reports discovery failures, retries, and can still launch the default shell', async () => {
    const connection = callbacks()
    connection.terminalShells.mockRejectedValueOnce(new Error('provider unavailable'))
    render(<TerminalView scope={{ sessionId }} store={new SidebarStore()} tabId="terminal:retry" launch={{ pending: true }} {...connection} />)
    await act(async () => {})
    expect(screen.getByRole('alert').textContent).toContain('Could not list shells.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await act(async () => {})
    expect(screen.getByRole('combobox').textContent).toContain('zsh')
    fireEvent.click(screen.getByRole('button', { name: 'Start terminal' }))
    expect(connectCall(connection, 0)[0].target).not.toHaveProperty('shellPath')
  })

  it('keeps malformed saved shell values out of Remote requests and preserves old tabs', () => {
    for (const meta of [undefined, null, { terminalLaunch: null }, { terminalLaunch: { shellPath: 42 } }]) {
      expect(terminalLaunchOf({ id: 'terminal:old', type: 'terminal', title: 'Terminal', meta })).toEqual({ pending: false })
    }
  })
})
