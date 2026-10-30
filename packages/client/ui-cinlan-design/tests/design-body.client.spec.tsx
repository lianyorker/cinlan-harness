// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PaneId, TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { CinlanDesignBody, type CinlanDesignBodyProps } from '../src/client/view/CinlanDesignBody.tsx'
import { createCinlanDesignStore, DEFAULT_DESIGN_TAB_STATE } from '../src/client/store.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })
let sequence = 0
function mount(copy: typeof en | typeof zh = en) {
  const store = createCinlanDesignStore().create(`design-test-${++sequence}`)
  const lifetime = new AbortController()
  let id = 'design-tab' as TabId
  const props = {
    sessionId: 'session' as SessionId,
    useTabInfo: () => ({
      sidebar: { expanded: true, fullscreen: false }, panel: { id: 'pane' as PaneId },
      tab: { id, kind: 'cinlan-design', title: 'Design', contentId: 'sidebar://design/1', visible: true,
        navigation: { address: 'sidebar://design/1', params: undefined, revision: 0 },
        signal: lifetime.signal, actions: { bindCommands: vi.fn(() => vi.fn()), openResource: vi.fn(), openTab: vi.fn(), close: vi.fn() } },
    }),
    useStore: <T,>(selector: (state: ReturnType<typeof store.getSnapshot>) => T): T => selector(useSyncExternalStore(
      listener => store.subscribe(listener), () => store.getSnapshot(),
    )),
    actions: store.actions,
    t: (key: keyof typeof en, params?: Readonly<Record<string, string | number>>) => {
      let text: string = copy[key]
      for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
      return text
    },
    onInjectDraft: vi.fn(),
  }
  const draw = () => render(<CinlanDesignBody {...props as CinlanDesignBodyProps} />)
  return { view: draw(), draw, props, store, id, lifetime, switchTab: (next: TabId) => { id = next } }
}
function load(view: ReturnType<typeof render>, html = '<main>Current page</main>') {
  const frame = view.container.querySelector('iframe')!
  const doc = frame.contentDocument!
  doc.body.innerHTML = html
  Object.defineProperty(doc, 'URL', { configurable: true, value: 'about:srcdoc' })
  Object.defineProperty(doc, 'readyState', { configurable: true, value: 'complete' })
  fireEvent.load(frame)
  return { frame, doc }
}
it.each([en, zh])('starts without a score and explains unavailable documents', (copy) => {
  const { view, store, id } = mount(copy)
  expect(view.getByRole('button', { name: copy['audit.button'] }).textContent).toContain(copy['audit.unchecked'])
  fireEvent.click(view.getByRole('button', { name: copy['audit.button'] }))
  expect(view.getByRole('alert').textContent).toBe(copy['audit.unavailable'])
  expect(store.getSnapshot().byTab[id]?.auditReport).toBeNull()
  expect(view.container.textContent).toMatchSnapshot()
})
it('audits the loaded document rather than the bundled demo and invalidates mutations', async () => {
  const { view, store, id } = mount()
  const { doc } = load(view, '<main style="background: linear-gradient(red, blue)">Actual target</main>')
  fireEvent.click(view.getByRole('button', { name: en['audit.button'] }))
  expect(store.getSnapshot().byTab[id]?.auditReport?.findings.some(finding => finding.ruleId === 'gradient' && finding.sample?.includes('Actual target'))).toBe(true)
  expect(view.getByText(en['audit.scope'])).toBeTruthy()
  act(() => { doc.body.textContent = 'Changed page' })
  await waitFor(() => { expect(store.getSnapshot().byTab[id]?.auditReport).toBeNull() })
})
it('rejects cross-origin access without substituting a demo score', () => {
  const { view, store, id } = mount()
  const { frame } = load(view)
  Object.defineProperty(frame, 'contentDocument', { configurable: true, get: () => { throw new DOMException('Denied', 'SecurityError') } })
  fireEvent.click(view.getByRole('button', { name: en['audit.button'] }))
  expect(view.getByRole('alert')).toBeTruthy()
  expect(store.getSnapshot().byTab[id]?.auditReport).toBeNull()
})
it('clears audit and annotations on navigation and reload', () => {
  const { view, store, id } = mount()
  load(view)
  fireEvent.click(view.getByRole('button', { name: en['audit.button'] }))
  expect(store.getSnapshot().byTab[id]?.auditReport?.score).toBe(100)
  const frame = view.container.querySelector('iframe')
  fireEvent.click(view.getByRole('button', { name: en.reload }))
  expect(view.container.querySelector('iframe')).not.toBe(frame)
  expect(store.getSnapshot().byTab[id]?.auditReport).toBeNull()
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'localhost:4173' } })
  fireEvent.submit(view.getByRole('textbox').closest('form')!)
  expect(store.getSnapshot().byTab[id]?.url).toBe('http://localhost:4173')
  expect(store.getSnapshot().byTab[id]?.pins).toEqual([])
})
it('restores tab settings on remount but never trusts an old audit', () => {
  const { view, draw, store, id } = mount()
  fireEvent.click(view.getByRole('button', { name: '390' }))
  load(view)
  fireEvent.click(view.getByRole('button', { name: en['audit.button'] }))
  view.unmount()
  const restored = draw()
  expect(restored.getByRole('button', { name: '390' }).getAttribute('aria-pressed')).toBe('true')
  expect(store.getSnapshot().byTab[id]?.auditReport).toBeNull()
  expect(restored.container.querySelector('iframe')?.parentElement?.style.width).toBe('390px')
})
it('retains persisted settings when the tab runtime unloads', () => {
  const { store, id, lifetime } = mount()
  const other = 'other-tab' as TabId
  act(() => { store.actions.replace(other, { ...DEFAULT_DESIGN_TAB_STATE, url: 'about:demo' }); lifetime.abort() })
  expect(store.getSnapshot().byTab[id]?.url).toBe('about:demo')
  expect(store.getSnapshot().byTab[other]?.url).toBe('about:demo')
})
it('keeps viewport settings independent when switching tab occurrences', () => {
  const { view, props, switchTab, store, id } = mount()
  fireEvent.click(view.getByRole('button', { name: '390' }))
  const other = 'another-design-tab' as TabId
  switchTab(other)
  view.rerender(<CinlanDesignBody {...props as CinlanDesignBodyProps} />)
  expect(view.getByRole('button', { name: '1440' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(view.getByRole('button', { name: '768' }))
  switchTab(id)
  view.rerender(<CinlanDesignBody {...props as CinlanDesignBodyProps} />)
  expect(view.getByRole('button', { name: '390' }).getAttribute('aria-pressed')).toBe('true')
  expect(store.getSnapshot().byTab[other]?.viewport).toBe('tablet')
})
it('restores saved URL and pins from a recreated persisted store', () => {
  const { view, store, id } = mount()
  const pin = { id: 'pin', xPercent: 50, yPercent: 40, comment: 'Keep this note', category: 'general' as const, createdAt: 1 }
  act(() => { store.actions.replace(id, { ...DEFAULT_DESIGN_TAB_STATE, url: 'https://preview.test/', pins: [pin], isPinMode: true }) })
  view.unmount()
  const recovered = createCinlanDesignStore().create(`design-test-${sequence}`)
  expect(recovered.getSnapshot().byTab[id]).toMatchObject({ url: 'https://preview.test/', pins: [pin], isPinMode: true })
})
it('writes fixes into the draft and closes style presets with Escape', () => {
  const { view, props } = mount()
  load(view, '<main style="background: linear-gradient(red, blue)">Actual target</main>')
  fireEvent.click(view.getByRole('button', { name: en['audit.button'] }))
  fireEvent.click(view.getByRole('button', { name: en['audit.inject'] }))
  expect(props.onInjectDraft).toHaveBeenCalledWith(expect.stringContaining('gradient'))
  fireEvent.click(view.getByRole('button', { name: en['styles.button'] }))
  expect(view.getAllByRole('button', { name: en['styles.apply'] })).toHaveLength(6)
  fireEvent.keyDown(view.getByRole('button', { name: en['styles.button'] }), { key: 'Escape' })
  expect(view.queryByRole('button', { name: en['styles.apply'] })).toBeNull()
})
it('supports keyboard annotations without submitting IME composition', () => {
  const { view, props, store, id } = mount()
  load(view)
  fireEvent.click(view.getByRole('button', { name: en['pin.toggle'] }))
  fireEvent.keyDown(view.getByRole('button', { name: en['pin.active'] }), { key: 'Enter' })
  const comment = view.getByPlaceholderText(en['pin.placeholder'])
  fireEvent.change(comment, { target: { value: 'Adjust spacing' } })
  fireEvent.keyDown(comment, { key: 'Enter', isComposing: true })
  expect(props.onInjectDraft).not.toHaveBeenCalled()
  fireEvent.keyDown(comment, { key: 'Enter' })
  expect(props.onInjectDraft).toHaveBeenCalledWith(expect.stringContaining('Adjust spacing'))
  expect(store.getSnapshot().byTab[id]?.pins[0]).toMatchObject({ xPercent: 50, yPercent: 50, comment: 'Adjust spacing' })
})
