// @vitest-environment jsdom
/** Retained-list races use the existing layout owner and never open native processes. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SidebarUiTerminalSnapshot } from '@deepseek-ai/dsh-sidebar-terminals/types'
import { TerminalRecovery } from '../src/client/TerminalRecovery.tsx'
import { rememberTerminalTitle } from '../src/client/terminal-launch.ts'
import { allLeaves, closeTab, createSidebarStore, openTabInActivePane, patchTab, type SidebarStore } from '../src/client/state.ts'

const entry = { sessionId: 'session', tabId: 'terminal:7', processId: 'process', title: 'Build', cwd: '/workspace', shellPath: '/bin/sh', pid: 42 } as SidebarUiTerminalSnapshot
function tabs(store: SidebarStore) {
  const state = store.getSnapshot().state!
  return [...allLeaves(state.splits), ...allLeaves(state.bottomSplits)].flatMap(leaf => leaf.tabs)
}
afterEach(async () => { cleanup(); await new Promise(resolve => setTimeout(resolve, 250)); localStorage.clear() })
it('publishes committed titles to the active snapshot and fences later replacement generations', () => {
  const store = createSidebarStore()
  store.setSession('session')
  store.reduce(state => openTabInActivePane(state, { id: entry.tabId, type: 'terminal', title: 'Initial',
    meta: { terminalProcessId: entry.processId } }))
  const changed = vi.fn()
  const unsubscribe = store.subscribe(changed)
  try {
    rememberTerminalTitle(store, entry)
    expect(tabs(store).find(tab => tab.id === entry.tabId)?.title).toBe('Build')
    expect(changed).toHaveBeenCalledOnce()
    store.reduce(state => patchTab(state, entry.tabId, { title: 'Replacement', meta: { terminalProcessId: 'new-process' } }))
    changed.mockClear()
    rememberTerminalTitle(store, entry)
    expect(tabs(store).find(tab => tab.id === entry.tabId)?.title).toBe('Replacement')
    expect(changed).not.toHaveBeenCalled()
    store.reduce(state => patchTab(state, entry.tabId, { meta: { terminalProcessId: entry.processId } }))
    store.setSession('other')
    changed.mockClear()
    rememberTerminalTitle(store, { ...entry, title: 'Saved while inactive' })
    expect(store.getSnapshot().sessionId).toBe('other')
    expect(changed).not.toHaveBeenCalled()
    store.setSession('session')
    expect(tabs(store).find(tab => tab.id === entry.tabId)?.title).toBe('Saved while inactive')
  } finally { unsubscribe() }
})
it('retries enumeration, restores canonical title, and reserves the recovered counter', async () => {
  const store = createSidebarStore()
  store.setSession('session')
  const terminal = { terminalListUi: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([entry]) }
  const mounted = render(<TerminalRecovery terminal={terminal} store={store} sessionId="session" />)
  try {
    const retry = await screen.findByRole('button', { name: 'Retry' })
    fireEvent.click(retry)
    await waitFor(() => { expect(tabs(store)).toContainEqual(expect.objectContaining({ id: entry.tabId, title: 'Build' })) })
    expect(store.getSnapshot().state?.nextTerminal).toBe(8)
    expect(terminal.terminalListUi).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  } finally { mounted.unmount() }
})
it('does not restore a closed tab or overwrite a title changed while enumeration was pending', async () => {
  const store = createSidebarStore()
  store.setSession('session')
  store.reduce(state => openTabInActivePane(state, { id: entry.tabId, type: 'terminal', title: 'Initial' }))
  const pending = Promise.withResolvers<readonly SidebarUiTerminalSnapshot[]>()
  const terminal = { terminalListUi: vi.fn(() => pending.promise) }
  const mounted = render(<TerminalRecovery terminal={terminal} store={store} sessionId="session" />)
  try {
    act(() => { store.reduce(state => patchTab(state, entry.tabId, { title: 'New title' })) })
    await act(async () => { pending.resolve([entry]); await pending.promise })
    expect(tabs(store).find(tab => tab.id === entry.tabId)?.title).toBe('New title')
    mounted.unmount()
    const later = Promise.withResolvers<readonly SidebarUiTerminalSnapshot[]>()
    terminal.terminalListUi.mockImplementation(() => later.promise)
    const next = render(<TerminalRecovery terminal={terminal} store={store} sessionId="session" />)
    act(() => {
      store.reduce(state => closeTab(state,
        allLeaves(state.splits).find(leaf => leaf.tabs.some(tab => tab.id === entry.tabId))!.id, entry.tabId))
    })
    await act(async () => { later.resolve([entry]); await later.promise })
    expect(tabs(store).some(tab => tab.id === entry.tabId)).toBe(false)
    next.unmount()
  } finally { mounted.unmount() }
})
it('ignores another window and an answer for a Session no longer displayed', async () => {
  const store = createSidebarStore()
  store.setSession('session')
  const pending = Promise.withResolvers<readonly SidebarUiTerminalSnapshot[]>()
  const terminal = { terminalListUi: vi.fn(() => pending.promise) }
  const mounted = render(<TerminalRecovery terminal={terminal} store={store} sessionId="session" windowId="window" />)
  try {
    await act(async () => { pending.resolve([entry]); await pending.promise })
    expect(tabs(store).some(tab => tab.id === entry.tabId)).toBe(false)
    const later = Promise.withResolvers<readonly SidebarUiTerminalSnapshot[]>()
    terminal.terminalListUi.mockImplementation(() => later.promise)
    mounted.rerender(<TerminalRecovery terminal={terminal} store={store} sessionId="session" />)
    act(() => { store.setSession('other') })
    await act(async () => { later.resolve([entry]); await later.promise })
    expect(tabs(store).some(tab => tab.id === entry.tabId)).toBe(false)
  } finally { mounted.unmount() }
})
