// @vitest-environment jsdom
/** Fixed native requests validate guest data and reject obsolete results. */
import { afterEach, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import { inspectNativeElement, locateNativeElement, readNativeHTML } from '../src/client/view/native-design.ts'
import { locatePageElement } from '../src/client/view/page-element-location.ts'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

function mount() {
  const host = document.createElement('div')
  host.id = 'native-page'
  const guest = document.createElement('webview')
  guest.dataset.sidebarBrowserFrame = 'webview'
  host.append(guest)
  document.body.append(host)
  const doc = document.implementation.createHTMLDocument('Guest')
  doc.body.innerHTML = '<button id="actual">Actual guest</button>'
  Object.defineProperty(doc, 'readyState', { value: 'complete' })
  const button = doc.getElementById('actual')!
  const hitTest = vi.fn((): Element | null => button)
  Object.defineProperty(doc, 'elementFromPoint', { value: hitTest })
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 100, 40))
  const execute = vi.fn(async (script: string): Promise<unknown> => {
    const result: unknown = runInNewContext(script, {
      document: doc, location: { href: 'https://guest.test/page' }, CSS: { escape: (value: string) => value },
      innerWidth: 800, innerHeight: 600,
    })
    return result
  })
  const getURL = vi.fn(() => 'https://guest.test/page')
  Object.assign(guest, { executeJavaScript: execute, getURL, isLoading: () => false })
  Object.defineProperties(guest, { clientWidth: { value: 800 }, clientHeight: { value: 600 } })
  vi.spyOn(guest, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 400, 300))
  return { guest, doc, execute, getURL, hitTest }
}

it('reads real guest HTML and hit-tests scaled guest coordinates', async () => {
  const h = mount()
  expect(await readNativeHTML('native-page')).toContain('Actual guest')
  expect(await inspectNativeElement('native-page', 130, 90)).toMatchObject({
    selector: '#actual', pageUrl: 'https://guest.test/page', text: 'Actual guest',
    rect: { x: 10, y: 20, width: 100, height: 40 },
  })
  expect(h.hitTest).toHaveBeenCalledWith(60, 80)
  expect(await inspectNativeElement('native-page', 50, 90)).toBeNull()
})

it.each(['navigation', 'removed', 'rejected', 'oversized', 'invalid', 'blank'])(
  'rejects %s guest snapshots without a fallback', async (reason) => {
    const h = mount()
    if (reason === 'blank') h.getURL.mockReturnValue('about:blank')
    h.execute.mockImplementation(async () => {
      if (reason === 'navigation') h.guest.dispatchEvent(new Event('did-start-navigation'))
      if (reason === 'removed') h.guest.remove()
      if (reason === 'rejected') throw new Error('Guest destroyed')
      return reason === 'oversized' ? 'x'.repeat(2097153) : { rect: { width: NaN } }
    })
    expect(await readNativeHTML('native-page')).toBeNull()
    expect(await inspectNativeElement('native-page', 130, 90)).toBeNull()
  },
)

it('does not extract input values or nested frames', async () => {
  const h = mount()
  for (const tag of ['input', 'textarea', 'iframe']) {
    const element = h.doc.createElement(tag)
    h.doc.body.append(element)
    h.hitTest.mockReturnValue(element)
    expect(await inspectNativeElement('native-page', 130, 90)).toBeNull()
  }
})

it('locates a verified saved element in current scaled window coordinates', async () => {
  mount()
  const element = await inspectNativeElement('native-page', 130, 90)
  expect(element).not.toBeNull()
  expect(await locateNativeElement('native-page', element!)).toEqual({ x: 105, y: 60, width: 50, height: 20 })
})

it('applies preview clipping to native guests through the Browser location callback', async () => {
  const h = mount()
  const element = await inspectNativeElement('native-page', 130, 90)
  const canvas = document.createElement('div')
  canvas.style.overflowY = 'auto'
  document.body.prepend(canvas)
  canvas.append(h.guest.parentElement!)
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 80, 400, 200))
  expect(await locatePageElement('native-page', element!)).toBeNull()
  vi.spyOn(h.guest, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 400, 300))
  expect(await locatePageElement('native-page', element!)).toEqual({ x: 105, y: 110, width: 50, height: 20 })
})

it.each(['url', 'ambiguous', 'text', 'outside', 'navigation'])('hides saved markers after %s changes', async (reason) => {
  const h = mount()
  const element = await inspectNativeElement('native-page', 130, 90)
  const button = h.doc.getElementById('actual')!
  if (reason === 'url') h.getURL.mockReturnValue('https://guest.test/other')
  if (reason === 'ambiguous') h.doc.body.append(button.cloneNode(true))
  if (reason === 'text') button.textContent = 'Replaced action'
  if (reason === 'outside') vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(new DOMRect(-10, 20, 100, 40))
  if (reason === 'navigation') h.execute.mockImplementation(async () => {
    h.guest.dispatchEvent(new Event('did-start-navigation'))
    return element
  })
  expect(await locateNativeElement('native-page', element!)).toBeNull()
})
