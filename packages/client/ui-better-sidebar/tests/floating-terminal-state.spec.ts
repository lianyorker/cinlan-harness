// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FloatingWorkspaceTerminalContext, FloatingWorkspaceWindowId } from '@deepseek-ai/dsh-sidebar-terminals/types'
import {
  allLeaves, createSidebarStore, createTerminalTab, firstLeaf, makeDefaultState,
  openTabInActivePane, reconcileAgentTerminals, SidebarStore, toggleBottomPanel,
  type SidebarState, type SidebarTab,
} from '../src/client/state.ts'

const windowA = '11111111-1111-4111-8111-111111111111' as FloatingWorkspaceWindowId
const windowB = '22222222-2222-4222-8222-222222222222' as FloatingWorkspaceWindowId
const terminalUuid = '33333333-3333-4333-8333-333333333333'
const agentUuid = '44444444-4444-4444-8444-444444444444'
const sessionId = 'shared-session'
const mainKey = `dsh-sidebar:v1:${sessionId}`
const keyA = `dsh-sidebar:v1:window:${windowA}:${sessionId}`
const keyB = `dsh-sidebar:v1:window:${windowB}:${sessionId}`

function ready(windowId: FloatingWorkspaceWindowId, directory: string): FloatingWorkspaceTerminalContext {
  return { windowId, status: 'ready', directory }
}

function tabs(state: SidebarState): SidebarTab[] {
  return [...allLeaves(state.splits), ...allLeaves(state.bottomSplits)].flatMap(leaf => leaf.tabs)
}

function stateOf(store: SidebarStore): SidebarState {
  const state = store.getSnapshot().state
  expect(state).toBeDefined()
  return state!
}

function openTerminal(store: SidebarStore, context?: FloatingWorkspaceTerminalContext): SidebarTab | undefined {
  let tab: SidebarTab | undefined
  store.reduce((state) => {
    const created = createTerminalTab(state, 'Terminal', context)
    if (created === null) return state
    tab = created.tab
    return openTabInActivePane({ ...state, ...created.patch }, created.tab)
  })
  return tab
}

function persistedState(nextTerminal: number, ...ids: string[]): SidebarState {
  let state = { ...makeDefaultState(), nextTerminal }
  for (const id of ids) state = openTabInActivePane(state, { id, type: 'terminal', title: id })
  return state
}

function readPersistedState(key: string): SidebarState {
  return JSON.parse(localStorage.getItem(key)!) as SidebarState
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('floating terminal state isolation', () => {
  it('reads each window namespace on its first load without importing or rewriting main ids', () => {
    const mainRaw = JSON.stringify(persistedState(9, 'terminal:7', `terminal:${terminalUuid}`, 'terminal:tlegacy1', `agent:${agentUuid}`))
    const floatingRaw = JSON.stringify(persistedState(3, `terminal:${windowA}:2`, `agent:${agentUuid}`))
    localStorage.setItem(mainKey, mainRaw)
    localStorage.setItem(keyA, floatingRaw)
    const reads = vi.spyOn(Storage.prototype, 'getItem')
    const main = new SidebarStore()
    const a = createSidebarStore({ floatingWindowId: windowA })
    const b = createSidebarStore({ floatingWindowId: windowB })

    main.setSession(sessionId)
    a.setSession(sessionId)
    b.setSession(sessionId)

    expect(reads.mock.calls.map(([key]) => key)).toEqual([mainKey, keyA, keyB])
    expect(tabs(stateOf(main)).filter(tab => tab.type === 'terminal').map(tab => tab.id))
      .toEqual(['terminal:7', `terminal:${terminalUuid}`, 'terminal:tlegacy1', `agent:${agentUuid}`])
    expect(tabs(stateOf(a)).filter(tab => tab.type === 'terminal').map(tab => tab.id))
      .toEqual([`terminal:${windowA}:2`, `agent:${agentUuid}`])
    expect(tabs(stateOf(b)).filter(tab => tab.type === 'terminal')).toEqual([])
    expect(stateOf(b).nextTerminal).toBe(1)

    a.update((state) => { state.width = 500 })
    b.update((state) => { state.width = 600 })
    vi.runAllTimers()
    expect(localStorage.getItem(mainKey)).toBe(mainRaw)
    expect(readPersistedState(keyA).nextTerminal).toBe(3)
    expect(readPersistedState(keyB).nextTerminal).toBe(1)

    main.update((state) => { state.width = 450 })
    vi.runAllTimers()
    const restoredMain = createSidebarStore()
    restoredMain.setSession(sessionId)
    expect(tabs(stateOf(restoredMain)).map(tab => tab.id)).toEqual(tabs(stateOf(main)).map(tab => tab.id))
  })

  it('keeps independent terminal counters and durable ids for main and two floating windows', () => {
    const main = createSidebarStore()
    const a = createSidebarStore({ floatingWindowId: windowA })
    const b = createSidebarStore({ floatingWindowId: windowB })
    for (const store of [main, a, b]) store.setSession(sessionId)

    const mainTab = openTerminal(main)!
    expect(mainTab.id).toMatch(/^terminal:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(mainTab?.meta).toEqual({ terminalLaunch: { pending: true } })
    expect(openTerminal(a, ready(windowA, '/a'))!.id).toBe(`terminal:${windowA}:1`)
    expect(openTerminal(a, ready(windowA, '/a'))!.id).toBe(`terminal:${windowA}:2`)
    expect(openTerminal(b, ready(windowB, '/b'))!.id).toBe(`terminal:${windowB}:1`)
    expect([main, a, b].map(store => stateOf(store).nextTerminal)).toEqual([2, 3, 2])
    vi.runAllTimers()

    const restoredMain = createSidebarStore()
    const restoredA = createSidebarStore({ floatingWindowId: windowA })
    const restoredB = createSidebarStore({ floatingWindowId: windowB })
    for (const store of [restoredMain, restoredA, restoredB]) store.setSession(sessionId)
    expect(tabs(stateOf(restoredMain)).find(tab => tab.type === 'terminal')).toEqual(mainTab)
    expect(openTerminal(restoredA, ready(windowA, '/a'))!.id).toBe(`terminal:${windowA}:3`)
    expect(openTerminal(restoredB, ready(windowB, '/b'))!.id).toBe(`terminal:${windowB}:2`)
    expect([restoredMain, restoredA, restoredB].map(store => stateOf(store).nextTerminal)).toEqual([2, 4, 3])
    expect(localStorage.length).toBe(3)
  })

  it('uses its fixed window identity for targeted session loads and debounced writes', () => {
    const targetMainKey = 'dsh-sidebar:v1:other-session'
    const targetFloatingKey = `dsh-sidebar:v1:window:${windowA}:other-session`
    const mainRaw = JSON.stringify(persistedState(10, 'terminal:9'))
    localStorage.setItem(targetMainKey, mainRaw)
    const options = { floatingWindowId: windowA }
    const store = new SidebarStore(options)
    options.floatingWindowId = windowB
    store.setSession(sessionId)
    openTerminal(store, ready(windowA, '/active'))
    const active = store.getSnapshot()
    const reads = vi.spyOn(Storage.prototype, 'getItem')

    store.reduceFor('other-session', (state) => {
      const created = createTerminalTab(state, 'Terminal', ready(windowA, '/other'))!
      return openTabInActivePane({ ...state, ...created.patch }, created.tab)
    })
    expect(reads).toHaveBeenCalledExactlyOnceWith(targetFloatingKey)
    expect(store.getSnapshot()).toBe(active)
    vi.runAllTimers()
    expect(localStorage.getItem(targetMainKey)).toBe(mainRaw)
    expect(localStorage.getItem(keyA)).not.toBeNull()
    expect(localStorage.getItem(keyB)).toBeNull()
    expect(localStorage.getItem(targetFloatingKey)).not.toBeNull()

    const restored = createSidebarStore({ floatingWindowId: windowA })
    restored.setSession('other-session')
    expect(tabs(stateOf(restored)).find(tab => tab.type === 'terminal')).toMatchObject({
      id: `terminal:${windowA}:1`, meta: { terminalLaunch: { pending: true }, terminalFloating: { windowId: windowA, directory: '/other' } },
    })
  })

  it('captures each new directory without changing existing metadata on preferences or reload', () => {
    const store = createSidebarStore({ floatingWindowId: windowA })
    store.setSession(sessionId)
    const context = { windowId: windowA, status: 'ready' as const, directory: '/first' }
    const first = openTerminal(store, context)!
    context.directory = '/second'
    store.setPrefs({ ...store.getPrefs(), terminalShell: 'other-shell', terminalFontSize: 20 })
    const second = openTerminal(store, context)!
    expect(first.meta).toEqual({ terminalLaunch: { pending: true }, terminalFloating: { windowId: windowA, directory: '/first' } })
    expect(second.meta).toEqual({ terminalLaunch: { pending: true }, terminalFloating: { windowId: windowA, directory: '/second' } })
    vi.runAllTimers()

    const restored = createSidebarStore({ floatingWindowId: windowA })
    restored.setPrefs({ ...restored.getPrefs(), terminalShell: 'another-shell' })
    restored.setSession(sessionId)
    expect(tabs(stateOf(restored)).filter(tab => tab.type === 'terminal')).toEqual([first, second])
    const before = restored.getSnapshot()
    expect(openTerminal(restored, { windowId: windowA, status: 'loading' })).toBeUndefined()
    expect(restored.getSnapshot()).toBe(before)
    expect(tabs(stateOf(restored)).filter(tab => tab.type === 'terminal')).toEqual([first, second])
    expect(openTerminal(restored, ready(windowA, '/third'))!.meta)
      .toEqual({ terminalLaunch: { pending: true }, terminalFloating: { windowId: windowA, directory: '/third' } })
  })

  it.each(['loading', 'unavailable'] as const)('cannot create an unqualified automatic terminal while context is %s', (status) => {
    const store = createSidebarStore({ floatingWindowId: windowA })
    store.setSession(sessionId)
    store.reduce(toggleBottomPanel)
    store.reduce(state => ({ ...state, activePane: firstLeaf(state.bottomSplits).id, bottomOpenedOnce: true }))
    const before = store.getSnapshot()

    expect(openTerminal(store, { windowId: windowA, status })).toBeUndefined()
    expect(store.getSnapshot()).toBe(before)
    expect(tabs(stateOf(store)).filter(tab => tab.type === 'terminal')).toEqual([])
    expect(stateOf(store).nextTerminal).toBe(1)
    vi.runAllTimers()
    expect(localStorage.getItem(mainKey)).toBeNull()
    expect(tabs(readPersistedState(keyA)).filter(tab => tab.type === 'terminal')).toEqual([])

    expect(openTerminal(store, ready(windowA, '/ready'))).toEqual({
      id: `terminal:${windowA}:1`, type: 'terminal', title: 'Terminal',
      meta: { terminalLaunch: { pending: true }, terminalFloating: { windowId: windowA, directory: '/ready' } },
    })
    expect(firstLeaf(stateOf(store).bottomSplits).tabs.map(tab => tab.id)).toEqual([`terminal:${windowA}:1`])
  })

  it('keeps agent registry identities unchanged across all window stores and reloads', () => {
    const stores = [
      createSidebarStore(),
      createSidebarStore({ floatingWindowId: windowA }),
      createSidebarStore({ floatingWindowId: windowB }),
    ]
    for (const store of stores) {
      store.setSession(sessionId)
      store.reduce(state => reconcileAgentTerminals(state, [{ uuid: agentUuid, title: 'Agent terminal' }]))
      expect(tabs(stateOf(store)).filter(tab => tab.type === 'terminal')).toEqual([
        { id: `agent:${agentUuid}`, type: 'terminal', title: 'Agent terminal' },
      ])
      expect(stateOf(store).nextTerminal).toBe(1)
    }
    vi.runAllTimers()
    for (const key of [mainKey, keyA, keyB]) {
      expect(tabs(readPersistedState(key)).find(tab => tab.type === 'terminal')!.id).toBe(`agent:${agentUuid}`)
    }
    const restored = createSidebarStore({ floatingWindowId: windowA })
    restored.setSession(sessionId)
    const before = restored.getSnapshot()
    restored.reduce(state => reconcileAgentTerminals(state, [{ uuid: agentUuid, title: 'Agent terminal' }]))
    expect(restored.getSnapshot()).toBe(before)
  })

  it('mints main-window UUIDs when the secure-context-only crypto method is unavailable', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
    const state = makeDefaultState()
    const created = createTerminalTab(state, 'Terminal')!
    expect(created.tab.id).toMatch(/^terminal:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(created.tab.meta).toEqual({ terminalLaunch: { pending: true } })
    expect(created.patch).toEqual({ nextTerminal: 2 })
    expect(state.nextTerminal).toBe(1)
  })
})
