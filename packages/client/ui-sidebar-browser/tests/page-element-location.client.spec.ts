// @vitest-environment jsdom
/** Saved iframe markers resolve current coordinates rather than historical geometry. */
import { afterEach, expect, it, vi } from 'vitest'
import { locatePageElement } from '../src/client/view/page-element-location.ts'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

function mount() {
  const canvas = document.createElement('div')
  const host = document.createElement('div')
  host.id = 'page'
  const frame = document.createElement('iframe')
  host.append(frame)
  canvas.append(host)
  document.body.append(canvas)
  const doc = frame.contentDocument!
  Object.defineProperties(doc, { URL: { value: 'https://preview.test/page', configurable: true },
    readyState: { value: 'complete', configurable: true } })
  doc.body.innerHTML = '<button id="actual">Actual action</button>'
  const target = doc.getElementById('actual')!
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 40, 120, 44))
  vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 400, 300))
  Object.defineProperties(frame, { offsetWidth: { value: 800 }, offsetHeight: { value: 600 },
    clientWidth: { value: 800 }, clientHeight: { value: 600 } })
  const element = { tagName: 'BUTTON', selector: '#actual', text: 'Actual action', pageUrl: 'https://preview.test/page',
    rect: { x: 999, y: 999, width: 1, height: 1 } }
  return { canvas, frame, doc, target, element }
}

it('maps current element geometry through the iframe display scale', async () => {
  const h = mount()
  expect(await locatePageElement('page', h.element)).toEqual({ x: 110, y: 70, width: 60, height: 22 })
})

it.each(['auto', 'scroll', 'hidden', 'clip'])('hides markers clipped by an %s preview ancestor and restores them when visible', async (overflow) => {
  const h = mount()
  h.canvas.style.overflowX = overflow
  h.canvas.style.overflowY = overflow
  vi.spyOn(h.canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 80, 400, 200))
  expect(await locatePageElement('page', h.element)).toBeNull()
  vi.spyOn(h.frame, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 400, 300))
  expect(await locatePageElement('page', h.element)).toEqual({ x: 110, y: 120, width: 60, height: 22 })
})

it('checks clipping per axis without treating visible overflow as clipped', async () => {
  const h = mount()
  h.canvas.style.overflowX = 'hidden'
  h.canvas.style.overflowY = 'visible'
  vi.spyOn(h.canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 80, 400, 200))
  expect(await locatePageElement('page', h.element)).not.toBeNull()
  h.canvas.style.overflowY = 'hidden'
  expect(await locatePageElement('page', h.element)).toBeNull()
})

it('hides markers outside the application window', async () => {
  const h = mount()
  vi.spyOn(h.frame, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, -100, 400, 300))
  expect(await locatePageElement('page', h.element)).toBeNull()
})

it.each(['url', 'loading', 'ambiguous', 'text', 'selector', 'outside', 'unreadable', 'removed'])(
  'rejects %s targets without falling back to saved coordinates', async (reason) => {
    const h = mount()
    if (reason === 'url') Object.defineProperty(h.doc, 'URL', { value: 'https://preview.test/other' })
    if (reason === 'loading') Object.defineProperty(h.doc, 'readyState', { value: 'loading' })
    if (reason === 'ambiguous') h.doc.body.append(h.target.cloneNode(true))
    if (reason === 'text') h.target.textContent = 'Replaced action'
    if (reason === 'selector') h.element.selector = '['
    if (reason === 'outside') vi.spyOn(h.target, 'getBoundingClientRect').mockReturnValue(new DOMRect(800, 20, 120, 44))
    if (reason === 'unreadable') vi.spyOn(h.frame, 'contentDocument', 'get').mockReturnValue(null)
    if (reason === 'removed') h.target.remove()
    expect(await locatePageElement('page', h.element)).toBeNull()
  },
)
