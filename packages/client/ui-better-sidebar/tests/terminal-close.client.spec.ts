/** Canonical sidebar close dispatch without a mounted terminal renderer. */
import './browser-globals.ts'
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '../src/context-types.ts'
import { registerBuiltins } from '../src/client/builtins/index.ts'
import type { BuiltinTabOptions } from '../src/client/builtins/tabs.tsx'
import { createBetterSidebarService } from '../src/client/service.ts'
import { allLeaves, createSidebarStore, openTabInActivePane } from '../src/client/state.ts'
import { gitCallbacks } from './git-fixture.client.ts'

function setup() {
  const terminal: NonNullable<BuiltinTabOptions['terminal']> = {
    connectTerminal: vi.fn(() => async () => {}), terminalInput: vi.fn(async () => {}), terminalResize: vi.fn(async () => {}),
    terminalCloseUi: vi.fn(async () => {}), terminalCloseAgent: vi.fn(async () => {}), terminalShells: vi.fn(async () => []),
  }
  const store = createSidebarStore()
  store.setSession('close-without-renderer')
  const service = createBetterSidebarService(store)
  const dispose = registerBuiltins({} as Context, service, { git: gitCallbacks(), terminal })
  return { terminal, store, service, dispose }
}

describe('terminal tab close through the sidebar service', () => {
  it('dispatches an offscreen UI tab close without opening its terminal view', () => {
    const { terminal, store, service, dispose } = setup()
    try {
      service.openTab({ type: 'terminal' })
      const tab = allLeaves(store.getSnapshot().state!.splits).flatMap(leaf => leaf.tabs).find(tab => tab.type === 'terminal')!
      service.closeTab(tab.id)
      service.closeTab(tab.id)
      expect(terminal.terminalCloseUi).toHaveBeenCalledExactlyOnceWith('close-without-renderer', tab.id)
      expect(terminal.connectTerminal).not.toHaveBeenCalled()
      expect(terminal.terminalCloseAgent).not.toHaveBeenCalled()
      expect(allLeaves(store.getSnapshot().state!.splits).flatMap(leaf => leaf.tabs)).not.toContainEqual(tab)
    } finally { dispose() }
  })

  it('closes the original agent identity with its owning Session', () => {
    const { terminal, store, service, dispose } = setup()
    const uuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    try {
      store.reduce(state => openTabInActivePane(state, { id: 'agent:' + uuid, type: 'terminal', title: 'Agent' }))
      service.closeTab('agent:' + uuid)
      expect(terminal.terminalCloseAgent).toHaveBeenCalledExactlyOnceWith({ sessionId: 'close-without-renderer', uuid })
      expect(terminal.terminalCloseUi).not.toHaveBeenCalled()
      expect(terminal.connectTerminal).not.toHaveBeenCalled()
    } finally { dispose() }
  })

  it('reports a failed native close without leaving an unhandled rejection', async () => {
    const { terminal, service, store, dispose } = setup()
    const failure = new Error('connection lost')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(terminal.terminalCloseUi).mockRejectedValueOnce(failure)
    try {
      service.openTab({ type: 'terminal' })
      const tab = allLeaves(store.getSnapshot().state!.splits).flatMap(leaf => leaf.tabs).find(tab => tab.type === 'terminal')!
      service.closeTab(tab.id)
      await vi.waitFor(() => { expect(warning).toHaveBeenCalledWith('dsh-better-sidebar: terminal close failed', failure) })
    } finally { warning.mockRestore(); dispose() }
  })
})
