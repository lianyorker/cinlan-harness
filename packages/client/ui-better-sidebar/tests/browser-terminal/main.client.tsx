/** Renderer-only fixture: controlled external callbacks, real React, SidebarStore, DOM and xterm. */
import { createRoot } from 'react-dom/client'
import { TerminalView, type TerminalViewProps } from '../../src/client/TerminalView.tsx'
import { allLeaves, closeTab, createSidebarStore, openTabInActivePane } from '../../src/client/state.ts'
import { terminalLaunchOf } from '../../src/client/terminal-launch.ts'

type Connect = TerminalViewProps['connectTerminal']
type Frame = Parameters<Parameters<Connect>[1]>[0]

import type { TerminalRendererFixture } from './types.ts'

const stage = document.getElementById('terminal-stage')!
const root = createRoot(stage)
const sessionId = 'terminal-browser-session'
const tabId = 'terminal:browser-fixture'
const floating: NonNullable<TerminalViewProps['floating']> = {
  windowId: '00112233-4455-4677-8899-aabbccddeeff' as NonNullable<TerminalViewProps['floating']>['windowId'],
  directory: 'missing-folder/用户输入',
}
const store = createSidebarStore({ floatingWindowId: floating.windowId })
store.setSession(sessionId)
store.setPrefs({ ...store.getPrefs(), terminalCursorBlink: false })
const chooser = new URLSearchParams(location.search).has('chooser')
if (!store.tabOpen(sessionId, tabId)) store.reduce(state => openTabInActivePane(state, {
  id: tabId, type: 'terminal', title: 'Terminal', meta: { terminalFloating: floating, ...chooser ? { terminalLaunch: { pending: true } } : {} },
}))
const tab = allLeaves(store.getSnapshot().state!.splits).flatMap(leaf => leaf.tabs).find(tab => tab.id === tabId)!

let receive: Parameters<Connect>[1]
let reportError: Parameters<Connect>[2]
let sequence = 0
const pendingCloses: Promise<void>[] = []
const attachmentId = 'terminal-browser-attachment' as Frame['attachmentId']
const fixture: TerminalRendererFixture = {
  requests: [], inputs: [], resizes: [], closes: [], closed: [],
  ready: () => receive({ type: 'ready', attachmentId, processId: '87654321-4321-4321-8321-cba987654321' as Extract<Frame, { type: 'ready' }>['processId'], pid: 1, cwd: '/renderer-fixture', shellName: 'controlled-callbacks' }),
  async write(data) {
    const current = ++sequence
    await receive({ type: 'data', attachmentId, sequence: current, data })
    return { sequence: current, inputsAtCompletion: fixture.inputs.map(([, input]) => input).join('') }
  },
  invalidDirectory: () => { reportError({ code: 'sidebarTerminals/invalid-directory', message: 'external directory rejection' }) },
  capturedDirectory: () => {
    const state = store.getSnapshot().state!
    const tab = allLeaves(state.splits).flatMap(leaf => leaf.tabs).find(item => item.id === tabId)
    return (tab?.meta as { terminalFloating?: { directory: string } } | undefined)?.terminalFloating?.directory
  },
  async unmount(action) {
    if (action === 'close-tab') {
      store.reduce((state) => {
        const pane = allLeaves(state.splits).find(leaf => leaf.tabs.some(tab => tab.id === tabId))!
        return closeTab(state, pane.id, tabId)
      })
    } else if (action === 'switch-session') {
      store.setSession('another-browser-session')
    }
    root.unmount()
    await Promise.all(pendingCloses)
  },
}

const props: TerminalViewProps = {
  scope: { sessionId }, tabId, store, floating, launch: terminalLaunchOf(tab),
  connectTerminal(request, onFrame, onError) {
    fixture.requests.push(request)
    receive = onFrame
    reportError = onError
    return (mode) => {
      fixture.closes.push(mode)
      const closing = Promise.resolve().then(() => { fixture.closed.push(mode) })
      pendingCloses.push(closing)
      return closing
    }
  },
  async terminalInput(...args) { fixture.inputs.push(args) },
  async terminalResize(...args) { fixture.resizes.push(args) },
  async terminalShells() { return [{ path: '/bin/bash', name: 'bash' }, { path: '/bin/zsh', name: 'zsh' }] },
}
window.terminalRenderer = fixture
root.render(<TerminalView {...props} />)
