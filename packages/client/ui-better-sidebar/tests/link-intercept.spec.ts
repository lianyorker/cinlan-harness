// @vitest-environment jsdom
/**
 * External-link interception policy tests: the pure decision (which http(s)
 * external links are taken over into the sidebar browser), the click shape
 * (plain left clicks only — modified clicks always bypass), and the
 * registered click capture (the caller's `takeoverEnabled(url)` gate).
 */
import { describe, expect, it } from 'vitest'
import { isExternalOpenClick, isPlainLeftClick, registerLinkInterception, shouldInterceptLink } from '../src/client/link-intercept.ts'

const SELF = 'http://127.0.0.1:3080'

describe('shouldInterceptLink', () => {
  it('takes over http(s) external links', () => {
    expect(shouldInterceptLink('https://example.com/page?a=1', SELF)).toBe('https://example.com/page?a=1')
    expect(shouldInterceptLink('http://example.com/', SELF)).toBe('http://example.com/')
  })

  it('ignores non-http(s) links (mailto:, javascript:, file:)', () => {
    expect(shouldInterceptLink('mailto:a@b.c', SELF)).toBeNull()
    expect(shouldInterceptLink('javascript:void(0)', SELF)).toBeNull()
    expect(shouldInterceptLink('file:///tmp/x.html', SELF)).toBeNull()
  })

  it('ignores unparsable hrefs', () => {
    expect(shouldInterceptLink('not a url', SELF)).toBeNull()
  })

  it('never takes over same-origin (GUI-internal) links', () => {
    expect(shouldInterceptLink('http://127.0.0.1:3080/settings', SELF)).toBeNull()
    expect(shouldInterceptLink('http://127.0.0.1:3080/chat/session-x', SELF)).toBeNull()
    // A different port of the same host is external.
    expect(shouldInterceptLink('http://127.0.0.1:9999/', SELF)).toBe('http://127.0.0.1:9999/')
  })

  it("takes over LAN hosts (the browser's own blocklist, not the link policy)", () => {
    // The link takeover funnels into the sidebar browser, which then applies
    // its own loopback/self address-bar policy on render — the interception
    // itself must not silently drop links the browser will surface as blocked.
    expect(shouldInterceptLink('http://192.168.1.1/', SELF)).toBe('http://192.168.1.1/')
  })
})

describe('isPlainLeftClick', () => {
  const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }

  it('accepts a plain left click', () => {
    expect(isPlainLeftClick(plain)).toBe(true)
  })

  it('bypasses modified clicks (Ctrl/Cmd/Shift/Alt) and non-left buttons', () => {
    expect(isPlainLeftClick({ ...plain, metaKey: true })).toBe(false)
    expect(isPlainLeftClick({ ...plain, ctrlKey: true })).toBe(false)
    expect(isPlainLeftClick({ ...plain, shiftKey: true })).toBe(false)
    expect(isPlainLeftClick({ ...plain, altKey: true })).toBe(false)
    expect(isPlainLeftClick({ ...plain, button: 1 })).toBe(false)
    expect(isPlainLeftClick({ ...plain, button: 2 })).toBe(false)
  })
})

describe('registerLinkInterception', () => {
  /** Dispatch one click on an anchor with the given absolute href. */
  const clickAnchor = (href: string, init: MouseEventInit = {}): void => {
    const anchor = document.createElement('a')
    anchor.href = href
    document.body.appendChild(anchor)
    anchor.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...init,
    }))
    anchor.remove()
  }

  it('passes the parsed URL to takeoverEnabled and only takes over when it returns true', () => {
    const seen: string[] = []
    const opened: string[] = []
    const dispose = registerLinkInterception({
      takeoverEnabled: (url) => {
        seen.push(url.protocol)
        return url.protocol === 'http:'
      },
      openInSidebar: (url) => { opened.push(url) },
      selfOrigin: SELF,
    })
    // https → the gate refuses (the sidebar-takeover defaults: https off).
    clickAnchor('https://example.com/page')
    // http → the gate passes, the click is taken over with the absolute href.
    clickAnchor('http://example.com/page')
    expect(seen).toEqual(['https:', 'http:'])
    expect(opened).toEqual(['http://example.com/page'])
    dispose()
  })

  it('never consults the gate for same-origin or non-http(s) links', () => {
    let gateCalls = 0
    const dispose = registerLinkInterception({
      takeoverEnabled: () => { gateCalls++; return true },
      openInSidebar: () => { throw new Error('must not open') },
      selfOrigin: SELF,
    })
    clickAnchor(`${SELF}/settings`)
    clickAnchor('mailto:a@b.c')
    expect(gateCalls).toBe(0)
    dispose()
  })

  it('bypasses the takeover on modified clicks even when the gate passes', () => {
    let gateCalls = 0
    const dispose = registerLinkInterception({
      takeoverEnabled: () => { gateCalls++; return true },
      openInSidebar: () => { throw new Error('must not open') },
      selfOrigin: SELF,
    })
    clickAnchor('http://example.com/', { ctrlKey: true })
    clickAnchor('http://example.com/', { metaKey: true })
    clickAnchor('http://example.com/', { button: 1 })
    expect(gateCalls).toBe(0)
    dispose()
  })

  it('desktop: a modified left click routes an external link to the OS browser, not the sidebar', () => {
    const external: string[] = []
    const dispose = registerLinkInterception({
      takeoverEnabled: () => { throw new Error('gate must not run for a modified click') },
      openInSidebar: () => { throw new Error('must not open in sidebar') },
      openExternalBrowser: (url) => { external.push(url) },
      selfOrigin: SELF,
    })
    clickAnchor('https://example.com/page', { ctrlKey: true })
    clickAnchor('http://example.com/other', { metaKey: true })
    // Same-origin GUI links are never handed out, even when modified.
    clickAnchor(`${SELF}/settings`, { ctrlKey: true })
    expect(external).toEqual(['https://example.com/page', 'http://example.com/other'])
    dispose()
  })

  it('desktop: right-clicking an external link opens it in the OS browser', () => {
    const external: string[] = []
    const dispose = registerLinkInterception({
      takeoverEnabled: () => false,
      openInSidebar: () => { throw new Error('must not open in sidebar') },
      openExternalBrowser: (url) => { external.push(url) },
      selfOrigin: SELF,
    })
    const anchor = document.createElement('a')
    anchor.href = 'https://example.com/page'
    document.body.appendChild(anchor)
    anchor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
    anchor.remove()
    expect(external).toEqual(['https://example.com/page'])
    dispose()
  })

  it('desktop: right-clicking plain content and images stays native', () => {
    const external: string[] = []
    const dispose = registerLinkInterception({
      takeoverEnabled: () => false,
      openInSidebar: () => { throw new Error('must not open in sidebar') },
      openExternalBrowser: (url) => { external.push(url) },
      selfOrigin: SELF,
    })
    const plain = document.createElement('div')
    const image = document.createElement('img')
    document.body.append(plain, image)
    const plainEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
    const imageEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })

    plain.dispatchEvent(plainEvent)
    image.dispatchEvent(imageEvent)

    expect(plainEvent.defaultPrevented).toBe(false)
    expect(imageEvent.defaultPrevented).toBe(false)
    expect(external).toEqual([])
    plain.remove()
    image.remove()
    dispose()
  })

  it('web (no openExternalBrowser): a plain left click still takes over, modified/right clicks fall through', () => {
    const opened: string[] = []
    const dispose = registerLinkInterception({
      takeoverEnabled: () => true,
      openInSidebar: (url) => { opened.push(url) },
      selfOrigin: SELF,
    })
    clickAnchor('http://example.com/plain')
    clickAnchor('http://example.com/mod', { ctrlKey: true })
    const anchor = document.createElement('a')
    anchor.href = 'http://example.com/ctx'
    document.body.appendChild(anchor)
    anchor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
    anchor.remove()
    // Only the plain click is taken over; the browser handles the rest natively.
    expect(opened).toEqual(['http://example.com/plain'])
    dispose()
  })
})

describe('isExternalOpenClick', () => {
  const base = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }

  it('is true for a modified left click (the new-tab gesture)', () => {
    expect(isExternalOpenClick({ ...base, ctrlKey: true })).toBe(true)
    expect(isExternalOpenClick({ ...base, metaKey: true })).toBe(true)
    expect(isExternalOpenClick({ ...base, shiftKey: true })).toBe(true)
    expect(isExternalOpenClick({ ...base, altKey: true })).toBe(true)
  })

  it('is false for a plain left click and for non-left buttons', () => {
    expect(isExternalOpenClick(base)).toBe(false)
    expect(isExternalOpenClick({ ...base, button: 1, ctrlKey: true })).toBe(false)
  })
})
