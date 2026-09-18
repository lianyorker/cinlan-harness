// @vitest-environment jsdom
/** The real Window adapter's URLs, popup admission observations, and owned listeners. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserWindowEnvironment } from '../src/client/window-environment.ts'
import { floatingRoute, floatingUrl } from '../src/client/window-route.ts'

const owner = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const target = '/?dsh-floating-workspace=1&dsh-floating-owner=' + owner
const originalUrl = window.location.href
const originalName = window.name
const disposers: Array<() => void> = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(window.crypto, 'randomUUID').mockReturnValue(owner)
  vi.spyOn(window, 'focus').mockImplementation(() => {})
  vi.spyOn(window, 'close').mockImplementation(() => {})
  vi.stubGlobal('opener', null)
  window.name = ''
})
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  window.history.replaceState(null, '', originalUrl)
  window.name = originalName
  document.body.replaceChildren()
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})

function inChild() {
  window.history.replaceState(null, '', target)
  window.name = 'dsh-floating-workspace-' + owner
  const opener = { closed: false, focus: vi.fn() }
  vi.stubGlobal('opener', opener)
  return opener
}

describe('floating app route', () => {
  it('keeps the real app origin/path and drops credentials, launch queries and hash', () => {
    const url = floatingUrl(new URL('https://user:secret@host.test/app/?token=private#launch'), owner, 'session-one')
    expect(url.href).toBe('https://host.test/app/?dsh-floating-workspace=1&dsh-floating-owner=' + owner + '&dsh-floating-session=session-one')
    expect(floatingRoute(url)).toEqual({ owner, session: 'session-one' })
    expect(floatingRoute(floatingUrl(new URL('dsh-app://app/index.html'), owner))).toEqual({ owner })
  })
  it.each([
    '?dsh-floating-workspace=0',
    '?dsh-floating-workspace=1',
    '?dsh-floating-workspace=1&dsh-floating-owner=invalid',
    target.replace('/', '') + '&unknown=value',
    target.replace('/', '') + '&dsh-floating-owner=' + owner,
    target.replace('/', '') + '&dsh-floating-session=',
    target.replace('/', '') + '&dsh-floating-session=' + 's'.repeat(513),
    target.replace('/', '') + '&dsh-floating-session=%00',
    target.replace('/', '') + '&dsh-floating-session=%C2%80',
  ])('refuses unrecognized or malformed external route fields: %s', (query) => {
    expect(floatingRoute(new URL('https://host.test/' + query))).toBeUndefined()
  })
  it.each([
    'https://user@host.test' + target,
    'https://:secret@host.test' + target,
    'https://host.test' + target + '#fragment',
    'file:///index.html' + target.replace('/', ''),
    'dsh-app://shell/index.html' + target.replace('/', ''),
    'dsh-app://app:123/index.html' + target.replace('/', ''),
    'dsh-app://app/other.html' + target.replace('/', ''),
  ])('refuses an invalid app route: %s', (url) => { expect(floatingRoute(new URL(url))).toBeUndefined() })
})

describe('browser app-window environment', () => {
  it('opens the same app artifact synchronously using only the current session and requested dimensions', () => {
    window.history.replaceState(null, '', '/?token=private#legacy')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const environment = browserWindowEnvironment(window, () => 'current-session', 500)
    expect(environment.child).toBe(false)
    expect(environment.readWindowId()).toBeUndefined()
    expect(environment.supported).toBe(true)
    expect(environment.open(400, 300)).toBeNull()
    expect(open).toHaveBeenCalledWith(window.location.origin + '/?dsh-floating-workspace=1&dsh-floating-owner=' + owner + '&dsh-floating-session=current-session',
      'dsh-floating-workspace-' + owner, 'popup=yes,width=400,height=300')
    environment.closeSelf()
    expect(window.close).not.toHaveBeenCalled()
  })
  it('reports a refused native app-window request as unavailable rather than a browser popup block', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const page = new Proxy(window, {
      get(target, key): unknown {
        return key === 'location' ? { href: 'dsh-app://app/index.html' } : Reflect.get(target, key)
      },
    })
    const environment = browserWindowEnvironment(page, () => undefined, 500)
    expect(() => environment.open(400, 300)).toThrow('Native app window was not admitted')
  })

  it('does not crash when an insecure browser lacks randomUUID', () => {
    // Browser capability absence is an environmental input, not a preference fallback.
    Object.defineProperty(window.crypto, 'randomUUID', { value: undefined, configurable: true })
    const environment = browserWindowEnvironment(window, () => undefined, 500)
    expect(environment.supported).toBe(false)
    expect(environment.open(400, 300)).toBeNull()
  })
  it('refuses nested windows and closes only an actual child with a live opener', () => {
    const opener = inChild()
    window.history.replaceState(null, '', target + '&dsh-floating-session=initial')
    const environment = browserWindowEnvironment(window, () => 'ignored', 500)
    expect(environment).toMatchObject({ child: true, supported: true, initialSession: 'initial' })
    expect(environment.readWindowId()).toBe(owner)
    expect(environment.open(400, 300)).toBeNull()
    environment.closeSelf()
    expect(opener.focus).toHaveBeenCalledOnce()
    expect(window.close).toHaveBeenCalledOnce()
    opener.closed = true
    expect(environment.readWindowId()).toBeUndefined()
    environment.closeSelf()
    expect(opener.focus).toHaveBeenCalledOnce()
    expect(window.close).toHaveBeenCalledTimes(2)
    vi.stubGlobal('opener', null)
    environment.closeSelf()
    expect(window.close).toHaveBeenCalledTimes(2)
  })
  it('rejects forged names, malformed markers and direct visits without a live opener', () => {
    window.history.replaceState(null, '', target)
    const invalidName = browserWindowEnvironment(window, () => undefined, 500)
    expect(invalidName.supported).toBe(false)
    expect(invalidName.readWindowId()).toBeUndefined()
    invalidName.closeSelf()
    inChild(); window.name = ''
    expect(browserWindowEnvironment(window, () => undefined, 500).supported).toBe(false)
    inChild(); vi.stubGlobal('opener', null)
    expect(browserWindowEnvironment(window, () => undefined, 500).supported).toBe(false)
    inChild(); vi.stubGlobal('opener', { closed: true })
    expect(browserWindowEnvironment(window, () => undefined, 500).supported).toBe(false)
    window.history.replaceState(null, '', '/?dsh-floating-workspace=1')
    const invalid = browserWindowEnvironment(window, () => undefined, 500)
    expect(invalid.child).toBe(true)
    expect(invalid.supported).toBe(false)
    expect(invalid.open(400, 300)).toBeNull()
    expect(window.close).not.toHaveBeenCalled()
  })
  it('restores only the still-connected original focused control on a live source page', () => {
    const button = document.createElement('button')
    document.body.append(button); button.focus()
    const restore = browserWindowEnvironment(window, () => undefined, 500).captureFocus()
    button.blur(); restore()
    expect(document.activeElement).toBe(button)
    button.remove(); restore()
    expect(document.activeElement).toBe(document.body)
    const withoutControl = browserWindowEnvironment(window, () => undefined, 500).captureFocus()
    vi.stubGlobal('closed', true)
    withoutControl()
    expect(window.focus).toHaveBeenCalledTimes(2)
  })
  it('observes exact WindowProxy closure on focus and timer, and removes every listener', () => {
    const environment = browserWindowEnvironment(window, () => undefined, 500)
    const target = { closed: false, close: vi.fn() }
    const closed = vi.fn(), exit = vi.fn()
    const offClosed = environment.observeClosed(target, closed)
    const offExit = environment.onPageExit(exit)
    disposers.push(offClosed, offExit)
    vi.advanceTimersByTime(500)
    expect(closed).not.toHaveBeenCalled()
    target.closed = true
    window.dispatchEvent(new Event('focus'))
    vi.advanceTimersByTime(500)
    expect(closed).toHaveBeenCalledTimes(2)
    window.dispatchEvent(new Event('pagehide'))
    expect(exit).toHaveBeenCalledOnce()
    offClosed(); offExit()
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('pagehide'))
    vi.advanceTimersByTime(500)
    expect(closed).toHaveBeenCalledTimes(2)
    expect(exit).toHaveBeenCalledOnce()
  })
})
