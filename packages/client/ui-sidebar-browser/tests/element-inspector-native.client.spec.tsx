// @vitest-environment jsdom
/** Native hover uses scaled guest geometry and discards obsolete read results. */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { inspectNativeElement } from '../src/client/view/native-design.ts'
import { ElementInspectorOverlay } from '../src/client/view/element-inspector.tsx'
import type { InspectedElementData } from '../src/client/view/element-inspector-utils.ts'

vi.mock('../src/client/view/native-design.ts', () => ({ inspectNativeElement: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals() })

const ELEMENT: InspectedElementData = { tagName: 'BUTTON', selector: '#actual', pageUrl: 'https://guest.test/page',
  rect: { x: 40, y: 60, width: 120, height: 40 } }

function mount() {
  let scheduled: FrameRequestCallback | undefined
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { scheduled = callback; return 1 }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn(() => { scheduled = undefined }))
  const onInspectElement = vi.fn()
  const onUnavailable = vi.fn()
  const onCancel = vi.fn()
  const view = render(<>
    <div id="native-viewport"><webview data-sidebar-browser-frame="webview" /></div>
    <ElementInspectorOverlay viewportId="native-viewport" onInspectElement={onInspectElement}
      onUnavailable={onUnavailable} onCancel={onCancel} />
  </>)
  const guest = view.container.querySelector('webview')!
  Object.defineProperties(guest, { clientWidth: { value: 800 }, clientHeight: { value: 600 } })
  vi.spyOn(guest, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 80, 400, 300))
  const overlay = view.getByTestId('browser-inspector-overlay')
  vi.spyOn(overlay, 'getBoundingClientRect').mockReturnValue(new DOMRect(90, 70, 420, 320))
  const move = (x = 130) => { fireEvent(overlay, new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: 120 })) }
  const frame = async () => {
    const callback = scheduled
    scheduled = undefined
    await act(async () => { callback?.(0) })
  }
  return { view, overlay, move, frame, onInspectElement, onUnavailable, onCancel }
}

it('highlights the real native target at display scale without opening an editor', async () => {
  const h = mount()
  vi.mocked(inspectNativeElement).mockResolvedValue(ELEMENT)
  h.move()
  await h.frame()
  const highlight = h.overlay.firstElementChild as HTMLElement
  expect(highlight.style.left).toBe('30px')
  expect(highlight.style.top).toBe('40px')
  expect(highlight.style.width).toBe('60px')
  expect(highlight.style.height).toBe('20px')
  expect(highlight.textContent).toContain('button')
  expect(h.onInspectElement).not.toHaveBeenCalled()
  expect(h.onUnavailable).not.toHaveBeenCalled()
  fireEvent.click(h.overlay, { clientX: 130, clientY: 120 })
  await act(async () => {})
  expect(h.onInspectElement).toHaveBeenCalledExactlyOnceWith(ELEMENT)
})

it('coalesces pointer moves and serializes native reads, keeping only the latest target', async () => {
  const h = mount()
  let finish: (value: InspectedElementData | null) => void = () => {}
  vi.mocked(inspectNativeElement).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  h.move(130); h.move(140)
  await h.frame()
  expect(inspectNativeElement).toHaveBeenCalledExactlyOnceWith('native-viewport', 140, 120)
  h.move(160); h.move(180)
  await h.frame()
  expect(inspectNativeElement).toHaveBeenCalledTimes(1)
  await act(async () => { finish(ELEMENT) })
  expect(h.overlay.firstElementChild).toBeNull()
  vi.mocked(inspectNativeElement).mockResolvedValue({ ...ELEMENT, tagName: 'A' })
  await h.frame()
  expect(inspectNativeElement).toHaveBeenLastCalledWith('native-viewport', 180, 120)
  expect(h.overlay.textContent).toContain('a ·')
})

it.each(['leave', 'escape', 'unmount', 'click'])('discards a late hover result after %s', async (reason) => {
  const h = mount()
  let finish: (value: InspectedElementData | null) => void = () => {}
  vi.mocked(inspectNativeElement).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  h.move()
  await h.frame()
  if (reason === 'leave') fireEvent.pointerLeave(h.overlay)
  if (reason === 'escape') fireEvent.keyDown(window, { key: 'Escape' })
  if (reason === 'unmount') h.view.unmount()
  if (reason === 'click') {
    vi.mocked(inspectNativeElement).mockResolvedValue(null)
    fireEvent.click(h.overlay, { clientX: 130, clientY: 120 })
  }
  await act(async () => { finish(ELEMENT) })
  expect(h.overlay.firstElementChild).toBeNull()
  expect(h.onInspectElement).not.toHaveBeenCalled()
  if (reason === 'escape') expect(h.onCancel).toHaveBeenCalledOnce()
})

it('clears a highlight for unreadable targets without showing a click failure', async () => {
  const h = mount()
  vi.mocked(inspectNativeElement).mockResolvedValue(ELEMENT)
  h.move()
  await h.frame()
  expect(h.overlay.firstElementChild).not.toBeNull()
  vi.mocked(inspectNativeElement).mockResolvedValue(null)
  h.move(400)
  await h.frame()
  expect(h.overlay.firstElementChild).toBeNull()
  expect(h.onUnavailable).not.toHaveBeenCalled()
})
