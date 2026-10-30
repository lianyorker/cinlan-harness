// @vitest-environment jsdom
/** Browser tools reuse the current carrier and invalidate obsolete audit results. */
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useSyncExternalStore } from 'react'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { BrowserDesignTools, type BrowserDesignToolsProps } from '../src/client/view/BrowserDesignTools.tsx'
import { en } from '../src/client/locales.ts'
import { createBrowserPinsStore } from '../src/client/browser-pins.ts'

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

function mount(native = false, readNativeHTML?: () => Promise<string | null>) {
  const injectDraft = vi.fn()
  const store = createBrowserPinsStore().create('session')
  const dismissInspection = vi.fn(() => { props.inspectedElement = null })
  const locateElement = vi.fn<BrowserDesignToolsProps['locateElement']>(async () => null)
  const props: { -readonly [Key in keyof BrowserDesignToolsProps]: BrowserDesignToolsProps[Key] } = {
    actions: store.actions, dismissInspection, locateElement, inspectedElement: null, mode: 'checks', annotationControlId: 'annotation-controls',
    useStore: selector => selector(useSyncExternalStore(listener => store.subscribe(listener), () => store.getSnapshot())),
    viewportId: 'browser-page', tabId: 'tab' as TabId,
    pageRevision: '1', loading: false, injectDraft, ...(readNativeHTML ? { readNativeHTML } : {}),
    t: (key, params) => {
      const messages: Readonly<Record<string, string>> = en
      let text = messages[key] ?? key
      for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
      return text
    },
  }
  const draw = (value: BrowserDesignToolsProps) => <>
    <div id="browser-page">{!native && <iframe title="Existing Browser page" />}</div>
    <BrowserDesignTools {...value} />
  </>
  const view = render(draw(props))
  const frame = view.container.querySelector('iframe')!
  const doc = frame?.contentDocument ?? document.implementation.createHTMLDocument('Native placeholder')
  Object.defineProperty(doc, 'URL', { configurable: true, value: 'https://preview.test/actual' })
  Object.defineProperty(doc, 'readyState', { configurable: true, value: 'complete' })
  doc.body.innerHTML = '<main style="background:linear-gradient(red,blue)">Real current page</main>'
  return { view, frame, doc, injectDraft, props, draw, store, dismissInspection, locateElement }
}

const ELEMENT = { tagName: 'BUTTON', selector: '#actual', pageUrl: 'https://preview.test/actual',
  rect: { x: 20, y: 30, width: 120, height: 44 } }

function select(h: ReturnType<typeof mount>) {
  h.props.inspectedElement = ELEMENT
  h.view.rerender(h.draw(h.props))
}

it('saves recorded annotations without changing the draft and appends only on explicit action', async () => {
  const h = mount()
  select(h)
  expect(h.view.getByRole('button', { name: en['pin.save'] })).toHaveProperty('disabled', true)
  fireEvent.change(h.view.getByRole('textbox', { name: en['pin.comment'] }), { target: { value: ' Reduce padding ' } })
  fireEvent.change(h.view.getByRole('combobox'), { target: { value: 'spatial' } })
  fireEvent.click(h.view.getByRole('button', { name: en['pin.save'] }))
  expect(h.store.getSnapshot().byTab[h.props.tabId]).toEqual([expect.objectContaining({
    element: ELEMENT, comment: 'Reduce padding', category: 'spatial',
  })])
  expect(h.injectDraft).not.toHaveBeenCalled()
  h.view.rerender(h.draw({ ...h.props, pageRevision: 'different-page' }))
  fireEvent.click(h.view.getByRole('button', { name: 'Page annotations (1)' }))
  fireEvent.click(h.view.getByRole('button', { name: en['pin.submit'] }))
  expect(h.injectDraft).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('https://preview.test/actual'))
  expect(h.injectDraft.mock.calls[0]![0]).toContain('120 × 44 CSS px at (20, 30)')
  fireEvent.click(h.view.getByRole('button', { name: en['pin.remove'] }))
  await waitFor(() => { expect(h.view.getByText(en['pin.empty'])).toBeDefined() })
  expect(h.injectDraft).toHaveBeenCalledTimes(1)
})

it.each(['cancel', 'navigation', 'load', 'loading', 'tab'])('discards an unsaved selection on %s', async (reason) => {
  const h = mount()
  select(h)
  fireEvent.change(h.view.getByRole('textbox', { name: en['pin.comment'] }), { target: { value: 'Unsaved' } })
  if (reason === 'cancel') fireEvent.click(h.view.getByRole('button', { name: en['pin.cancel'] }))
  if (reason === 'navigation') h.view.rerender(h.draw({ ...h.props, pageRevision: '2' }))
  if (reason === 'loading') h.view.rerender(h.draw({ ...h.props, loading: true }))
  if (reason === 'tab') h.view.rerender(h.draw({ ...h.props, tabId: 'other' as TabId }))
  if (reason === 'load') fireEvent.load(h.frame)
  await waitFor(() => { expect(h.view.queryByRole('textbox', { name: en['pin.comment'] })).toBeNull() })
  expect(h.store.getSnapshot().byTab).toEqual({})
  expect(h.injectDraft).not.toHaveBeenCalled()
})

it('closes the annotation editor on unmount without saving anything', () => {
  const h = mount(true)
  select(h)
  expect(h.view.getByRole('dialog')).toBeDefined()
  h.view.unmount()
  expect(h.view.queryByRole('dialog')).toBeNull()
  expect(h.store.getSnapshot().byTab).toEqual({})
  expect(h.injectDraft).not.toHaveBeenCalled()
})

it('audits the existing document and invalidates the result on mutations', async () => {
  const h = mount()
  fireEvent.click(h.view.getByRole('button', { name: en['audit.button'] }))
  expect(h.view.getByText(en['audit.scope'])).toBeDefined()
  expect(h.view.container.querySelectorAll('iframe')).toHaveLength(1)
  expect(h.injectDraft).not.toHaveBeenCalled()
  fireEvent.click(h.view.getByRole('button', { name: en['audit.inject'] }))
  expect(h.injectDraft).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('gradient'))
  h.doc.body.textContent = 'Page changed'
  await waitFor(() => { expect(h.view.queryByText(en['audit.scope'])).toBeNull() })
})

it('audits native HTML and refuses to inject findings after DOM changes', async () => {
  const read = vi.fn(async () => '<main style="background:linear-gradient(red,blue)">Native page</main>')
  const h = mount(true, read)
  fireEvent.click(h.view.getByRole('button', { name: en['audit.button'] }))
  await waitFor(() => { expect(h.view.getByText(en['audit.scope'])).toBeDefined() })
  expect(h.view.container.querySelector('iframe')).toBeNull()
  read.mockResolvedValue('<main>Changed</main>')
  fireEvent.click(h.view.getByRole('button', { name: en['audit.inject'] }))
  await waitFor(() => { expect(h.view.getByRole('alert')).toBeDefined() })
  expect(h.injectDraft).not.toHaveBeenCalled()
})

it('discards an asynchronous native audit after navigation', async () => {
  let finish: (html: string | null) => void = () => {}
  const read = () => new Promise<string | null>((resolve) => { finish = resolve })
  const h = mount(true, read)
  fireEvent.click(h.view.getByRole('button', { name: en['audit.button'] }))
  h.view.rerender(h.draw({ ...h.props, pageRevision: '2' }))
  await act(async () => { finish('<main>Old page</main>') })
  expect(h.view.queryByText(en['audit.scope'])).toBeNull()
  expect(h.injectDraft).not.toHaveBeenCalled()
})

it('injects native findings only after rechecking an unchanged snapshot', async () => {
  const read = vi.fn(async () => '<main style="background:linear-gradient(red,blue)">Native page</main>')
  const h = mount(true, read)
  fireEvent.click(h.view.getByRole('button', { name: en['audit.button'] }))
  await waitFor(() => { expect(h.view.getByText(en['audit.scope'])).toBeDefined() })
  fireEvent.click(h.view.getByRole('button', { name: en['audit.inject'] }))
  await waitFor(() => { expect(h.injectDraft).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('gradient')) })
  expect(read).toHaveBeenCalledTimes(2)
})

it('preserves the draft when native reading rejects', async () => {
  const h = mount(true, async () => { throw new Error('Guest destroyed') })
  fireEvent.click(h.view.getByRole('button', { name: en['audit.button'] }))
  await waitFor(() => { expect(h.view.getByRole('alert')).toBeDefined() })
  expect(h.injectDraft).not.toHaveBeenCalled()
})

it.each(['cross-origin', 'blank', 'loading', 'guest'])('produces no score or draft for %s', (reason) => {
  const h = mount()
  if (reason === 'cross-origin') vi.spyOn(h.frame, 'contentDocument', 'get').mockReturnValue(null)
  if (reason === 'blank') Object.defineProperty(h.doc, 'URL', { value: 'about:blank' })
  if (reason === 'loading') h.view.rerender(h.draw({ ...h.props, loading: true }))
  if (reason === 'guest') h.frame.replaceWith(document.createElement('webview'))
  fireEvent.click(h.view.getByRole('button', { name: en['audit.button'] }))
  expect(h.view.getByRole('alert').textContent).toBe(en['audit.unavailable'])
  expect(h.view.queryByText(en['audit.scope'])).toBeNull()
  expect(h.injectDraft).not.toHaveBeenCalled()
})

it('clears the score after navigation and appends directions only on explicit action', () => {
  const h = mount()
  fireEvent.click(h.view.getByRole('button', { name: en['audit.button'] }))
  h.view.rerender(h.draw({ ...h.props, pageRevision: '2' }))
  expect(h.view.queryByText(en['audit.scope'])).toBeNull()
  h.view.rerender(h.draw({ ...h.props, mode: 'styles', pageRevision: '2' }))
  fireEvent.click(h.view.getAllByRole('button', { name: en['styles.apply'] })[0]!)
  expect(h.injectDraft).toHaveBeenCalledOnce()
  expect(h.view.container.querySelector('iframe')).toBe(h.frame)
})

it('reopens a verified marker and updates the existing annotation without writing the draft', async () => {
  const h = mount()
  h.locateElement.mockResolvedValue({ x: 80, y: 120, width: 120, height: 44 })
  select(h)
  fireEvent.change(h.view.getByRole('textbox', { name: en['pin.comment'] }), { target: { value: 'Original' } })
  fireEvent.click(h.view.getByRole('button', { name: en['pin.save'] }))
  const before = h.store.getSnapshot().byTab[h.props.tabId]![0]!
  const marker = await h.view.findByRole('button', { name: 'Edit page annotation 1' })
  expect(marker.style.left).toBe('80px')
  fireEvent.click(marker)
  expect(h.view.getByRole('textbox', { name: en['pin.comment'] })).toHaveProperty('value', 'Original')
  fireEvent.change(h.view.getByRole('textbox', { name: en['pin.comment'] }), { target: { value: 'Updated' } })
  fireEvent.click(h.view.getByRole('button', { name: en['pin.save'] }))
  expect(h.store.getSnapshot().byTab[h.props.tabId]).toEqual([{ ...before, comment: 'Updated' }])
  expect(h.injectDraft).not.toHaveBeenCalled()
  h.locateElement.mockResolvedValue(null)
  await waitFor(() => { expect(h.view.queryByRole('button', { name: 'Edit page annotation 1' })).toBeNull() })
})
