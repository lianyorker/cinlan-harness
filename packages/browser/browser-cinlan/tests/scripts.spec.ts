// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearOverlayScript, overlaySelectionScript, removeElementMarkerScript, verifyElementScript } from '../src/scripts.ts'

const key = 'test-selection'
const marker = 'data-dsh-browser-element'

function button(text: string): HTMLButtonElement {
  const node = document.createElement('button')
  node.textContent = text
  vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 30, 40))
  document.body.append(node)
  return node
}

afterEach(() => {
  window.eval(clearOverlayScript(key))
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('Cinlan page selection scripts', () => {
  it('selects the actual click target when the last hover belongs to another element', async () => {
    const first = button('First')
    const clicked = button('Clicked')
    const targetClick = vi.fn()
    clicked.addEventListener('click', targetClick)
    const selected = window.eval(overlaySelectionScript(key)) as Promise<string>
    first.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
    expect(document.querySelector('#__dsh_browser_element_capture_overlay__')?.getAttribute('style')).toContain('left: 10px')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    clicked.dispatchEvent(click)
    expect(JSON.parse(await selected)).toMatchObject({ tagName: 'button', name: 'Clicked', rect: { x: 10, y: 20, width: 30, height: 40 } })
    expect(clicked.getAttribute(marker)).toBe(key)
    expect(first.hasAttribute(marker)).toBe(false)
    expect(click.defaultPrevented).toBe(true)
    expect(targetClick).not.toHaveBeenCalled()
    expect(document.querySelector('#__dsh_browser_element_capture_overlay__')).toBeNull()
    clicked.click()
    expect(targetClick).toHaveBeenCalledOnce()
    const verified = window.eval(verifyElementScript(key, true)) as string
    expect(JSON.parse(verified)).toMatchObject({ name: 'Clicked' })
    expect(clicked.hasAttribute(marker)).toBe(false)
  })

  it('settles Escape and external cleanup without retaining markers or overlay listeners', async () => {
    const target = button('Target')
    const selected = window.eval(overlaySelectionScript(key)) as Promise<string>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await expect(selected).resolves.toBe('null')
    expect(target.hasAttribute(marker)).toBe(false)
    const next = window.eval(overlaySelectionScript(key)) as Promise<string>
    expect(window.eval(clearOverlayScript(key))).toBe('null')
    await expect(next).resolves.toBe('null')
    expect(document.querySelector('#__dsh_browser_element_capture_overlay__')).toBeNull()
    expect(window.eval(clearOverlayScript(key))).toBe('null')
  })

  it('ignores stale cleanup keys and settles an older selection when a new one starts', async () => {
    const previous = window.eval(overlaySelectionScript('previous')) as Promise<string>
    const current = window.eval(overlaySelectionScript(key)) as Promise<string>
    await expect(previous).resolves.toBe('null')
    window.eval(clearOverlayScript('previous'))
    const target = button('Current')
    target.click()
    expect(JSON.parse(await current)).toMatchObject({ name: 'Current' })
    expect(target.getAttribute(marker)).toBe(key)
  })

  it('rejects ambiguous markers and removes only exact-key attributes, including quoted keys', () => {
    const quoted = 'test-"-\\-key'
    const first = button('First')
    const second = button('Second')
    const other = button('Other')
    first.setAttribute(marker, quoted)
    second.setAttribute(marker, quoted)
    other.setAttribute(marker, key)
    expect(window.eval(verifyElementScript(quoted, false))).toBe('null')
    window.eval(removeElementMarkerScript(quoted))
    expect(first.hasAttribute(marker)).toBe(false)
    expect(second.hasAttribute(marker)).toBe(false)
    expect(other.getAttribute(marker)).toBe(key)
    expect(window.eval(verifyElementScript('missing', false))).toBe('null')
  })
})
