/**
 * Sidebar crash tests — the two failure modes behind issue #31.
 *
 * 1. Layout-push leak: the layout-push effect writes
 *    `--dsh-sidebar-width/--dsh-sidebar-height` on document.documentElement.
 *    Unmounting the Sidebar for ANY reason (error-boundary swap, plugin
 *    disable, HMR) must clear them — otherwise layout.css keeps squeezing
 *    `#root` with a stale margin and "the sidebar cannot be hidden" until a
 *    full page reload.
 *
 * 2. Tab crash containment: a render error inside ONE tab's content must not
 *    take down the whole sidebar. The per-tab boundary shows a strip inside
 *    that tab's pane while the toggle cluster, the other tabs, and the panel
 *    itself stay alive; the retry button recovers a transient crash.
 *
 * Rendered with the REAL Sidebar shell + real store/service against a minimal
 * fake context (createRoot + act(), the repo's jsdom pattern).
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// The act() environment flag (React 18.2 reads it before flushing effects).
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { Sidebar } from '../src/client/Sidebar.tsx'
import { allLeaves, createSidebarStore, type SidebarStore } from '../src/client/state.ts'
import { EditorHost } from '../src/client/EditorHost.tsx'
import { api } from '../src/client/api.ts'
import { editorFileKey, fileSourceScope } from '../src/client/file-source.ts'
import { createBetterSidebarService, type BetterSidebarService } from '../src/client/service.ts'
import { t } from '../src/client/locales.ts'

/** jsdom has no WebSocket; the agent-terminals push effect constructs one on mount. */
class FakeWebSocket {
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  close = (): void => {}
}

interface MountedSidebar {
  container: HTMLDivElement
  store: SidebarStore
  service: BetterSidebarService
  unmount: () => void
}

/** Mount the real Sidebar shell against a minimal context (real store + service). */
function mountSidebar(sessionId = 's1'): MountedSidebar {
  vi.stubGlobal('WebSocket', FakeWebSocket)
  const container = document.createElement('div')
  document.body.append(container)
  const store = createSidebarStore()
  const service = createBetterSidebarService(store)
  // Fresh-session seed: open the panel explicitly (openByDefault defaults off).
  store.setPrefs({ ...store.getPrefs(), openByDefault: true })
  store.setSession(sessionId)
  // useSyncExternalStore requires STABLE snapshots across calls (the real DSH
  // services return stable objects) — a fresh object per call loops forever.
  const localeSnapshot = { active: 'en' }
  const sessionsSnapshot = {
    current: sessionId,
    // cwd present → api.sessionCwd is never called in these tests.
    byId: { [sessionId]: { cwd: '/tmp' } },
  }
  const ctx = {
    locale: { subscribe: () => () => {}, getSnapshot: () => localeSnapshot },
    sessions: { list: { subscribe: () => () => {}, getSnapshot: () => sessionsSnapshot } },
    betterSidebar: service,
  }
  const root: Root = createRoot(container)
  act(() => { root.render(createElement(Sidebar, { ctx: ctx as never, store })) })
  return {
    container,
    store,
    service,
    unmount: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('layout-push variable cleanup', () => {
  it('clears --dsh-sidebar-width/--dsh-sidebar-height when the sidebar unmounts', () => {
    const { store, unmount } = mountSidebar()
    const htmlStyle = document.documentElement.style
    // The seeded session is open: the layout push is applied on mount.
    const width = store.getSnapshot().state!.width
    expect(htmlStyle.getPropertyValue('--dsh-sidebar-width')).toBe(`${width}px`)
    expect(htmlStyle.getPropertyValue('--dsh-sidebar-height')).toBe('0px')
    // Any unmount (boundary swap, plugin disable, HMR) must release the push.
    unmount()
    expect(htmlStyle.getPropertyValue('--dsh-sidebar-width')).toBe('')
    expect(htmlStyle.getPropertyValue('--dsh-sidebar-height')).toBe('')
  })
})

describe('visible cross-Session file preview', () => {
  it.each(['fsRead', 'mediaUrl', 'custom'] as const)('keeps the child reader for %s without changing navigation', async (strategy) => {
    const sessionId = `visible-preview-${strategy}`
    const source = { sessionId: 'preview-child', cwd: '/child/project' }
    const path = '/child/project/report.md'
    const read = vi.spyOn(api, 'fsRead').mockResolvedValue({ kind: 'text', content: 'child file', truncated: false })
    onTestFinished(() => read.mockRestore())
    const load = vi.fn().mockResolvedValue('child custom file')
    const { container, store, service, unmount } = mountSidebar(sessionId)
    onTestFinished(unmount)
    act(() => {
      service.registerTab({ id: 'editor', title: 'Files', dedupeKey: editorFileKey,
        component: props => props.tab.path === undefined ? null : createElement(EditorHost, {
          ...props, expanded: props.expanded ?? [],
          onToggleDir: props.onToggleDir ?? (() => {}),
          onReferenceFile: props.onReferenceFile ?? (() => {}),
        }) })
      service.registerFileViewer({ id: 'source-test', exts: ['md'], fetchStrategy: strategy, load,
        component: props => createElement('output', {
          'data-preview-source': props.scope.sessionId,
          'data-preview-path': props.path,
          'data-preview-media': props.mediaUrl,
        }, props.content ?? 'loaded'),
      })
    })
    await act(async () => { await service.openFile(source, 'report.md') })
    const preview = container.querySelector('output[data-preview-source]')!
    expect(preview).not.toBeNull()
    expect(preview.getAttribute('data-preview-source')).toBe(source.sessionId)
    expect(preview.getAttribute('data-preview-path')).toBe(path)
    expect(store.getSnapshot().sessionId).toBe(sessionId)
    expect(store.getSnapshot().state!.panelOpen).toBe(true)
    if (strategy === 'fsRead') expect(read).toHaveBeenCalledWith(source, path)
    else expect(read).not.toHaveBeenCalled()
    if (strategy === 'custom') expect(load).toHaveBeenCalledWith(path, source, expect.any(AbortSignal))
    if (strategy === 'mediaUrl') {
      const url = new URL(preview.getAttribute('data-preview-media')!, location.href)
      expect(url.searchParams.get('sessionId')).toBe(source.sessionId)
      expect(url.searchParams.get('path')).toBe(path)
    }
    await vi.waitFor(() => {
      expect(localStorage.getItem(`dsh-sidebar:v1:${sessionId}`)).toContain('fileSource')
    })
    const restored = createSidebarStore()
    restored.setSession(sessionId)
    const restoredTab = allLeaves(restored.getSnapshot().state!.splits).flatMap(leaf => leaf.tabs)
      .find(tab => tab.path === path)!
    expect(fileSourceScope(restoredTab)).toEqual(source)
  })

  it('refuses malformed saved source metadata rather than selecting the layout reader', () => {
    expect(() => fileSourceScope({ id: 'saved', type: 'editor', title: 'File',
      meta: { fileSource: { sessionId: null } } })).toThrow('Invalid saved file source Session')
  })
})

describe('fullscreen sidebar', () => {
  it('restores saved geometry and mounted tab content after fullscreen and Escape', () => {
    const { container, store, service, unmount } = mountSidebar()
    onTestFinished(unmount)
    act(() => {
      store.setPrefs({ ...store.getPrefs(), bottomPanelAutoTerminal: false })
      service.registerTab({ id: 'fullscreen-test', title: 'Preview',
        component: () => createElement('textarea', { 'aria-label': 'Preview draft', defaultValue: 'kept draft' }) })
      service.openTab({ type: 'fullscreen-test', title: 'Preview' })
      store.reduce(state => ({ ...state, width: 410, bottomHeight: 190, bottomOpen: true }))
    })
    const saved = store.getSnapshot().state!
    const draft = container.querySelector('textarea')!
    const panel = container.querySelector<HTMLDivElement>('[data-dsh-panel]:not([data-dsh-bottom-panel])')!
    const button = (label: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
    act(() => { button(t('fullscreenSidebar')).click() })
    expect(panel.style.width).toBe('100vw')
    expect(panel.hasAttribute('data-fullscreen')).toBe(true)
    expect(document.documentElement.style.getPropertyValue('--dsh-sidebar-width')).toBe('0px')
    expect(document.documentElement.style.getPropertyValue('--dsh-sidebar-height')).toBe('0px')
    expect(container.querySelector<HTMLDivElement>('[data-dsh-bottom-panel]')!.style.visibility).toBe('hidden')
    expect(container.querySelector('textarea')).toBe(draft)
    expect(store.getSnapshot().state).toBe(saved)
    act(() => { button(t('restoreSidebar')).click() })
    expect(panel.style.width).toBe('410px')
    expect(document.documentElement.style.getPropertyValue('--dsh-sidebar-width')).toBe('410px')
    expect(document.documentElement.style.getPropertyValue('--dsh-sidebar-height')).toBe('190px')
    expect(store.getSnapshot().state).toBe(saved)
    act(() => { button(t('fullscreenSidebar')).click() })
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(panel.hasAttribute('data-fullscreen')).toBe(false)
    expect(panel.style.width).toBe('410px')
    expect(container.querySelector('textarea')).toBe(draft)
    expect(draft.value).toBe('kept draft')
  })
})

describe('tab crash containment', () => {
  it('a crashing tab shows an in-pane strip while the cluster and panel survive', () => {
    const { container, service, store } = mountSidebar()
    service.registerTab({
      id: 'crash',
      title: 'Crash',
      component: () => { throw new Error('boom') },
    })
    act(() => { service.openTab({ type: 'crash', title: 'Crash' }) })
    // The strip lives inside the tab's pane — the crash is contained.
    expect(container.textContent).toContain('boom')
    expect(container.textContent).toContain(t('terminalRetry'))
    // The toggle cluster and the panel itself survived (no full-tree swap):
    // the collapse button is still there and the layout push is still live.
    expect(container.querySelector(`[aria-label="${t('collapse')}"]`)).not.toBeNull()
    expect(document.documentElement.style.getPropertyValue('--dsh-sidebar-width')).toBe(
      `${store.getSnapshot().state!.width}px`,
    )
  })

  it('the retry button recovers a tab whose crash has since been fixed', () => {
    // A PERSISTENT render error reaches the boundary strip (React 18.2
    // auto-recovers transient throws — one bad render followed by a good
    // retry is swallowed as a recoverable error and never shows a strip).
    let shouldThrow = true
    const { container, service } = mountSidebar()
    service.registerTab({
      id: 'crash-until-fixed',
      title: 'Crash until fixed',
      component: () => {
        if (shouldThrow) throw new Error('transient')
        return createElement('div', null, 'recovered')
      },
    })
    act(() => { service.openTab({ type: 'crash-until-fixed', title: 'Crash until fixed' }) })
    expect(container.textContent).toContain('transient')
    const retry = [...container.querySelectorAll('button')]
      .find(button => button.textContent === t('terminalRetry'))
    expect(retry).toBeDefined()
    // The crash condition is gone (e.g. the data arrived): the retry button
    // remounts the tab's content and the strip clears.
    shouldThrow = false
    act(() => { retry!.click() })
    expect(container.textContent).toContain('recovered')
    expect(container.textContent).not.toContain('transient')
  })
})
