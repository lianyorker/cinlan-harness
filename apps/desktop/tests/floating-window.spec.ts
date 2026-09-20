import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, BrowserWindowConstructorOptions, HandlerDetails, WebContents, WindowOpenHandlerResponse } from 'electron'
import { installFloatingWindowPolicy } from '../src/floating-window.ts'

const APP = 'dsh-app://app/index.html'
const OWNER = 'b9c7a500-5102-4583-a621-cdc4fd630ae2'
const OTHER = '7858252d-64d9-4c40-8651-9bb4c527d594'
const NAME = 'dsh-floating-workspace-' + OWNER
const QUERY = '?dsh-floating-workspace=1&dsh-floating-owner=' + OWNER
const TARGET = APP + QUERY
const PRELOAD = '/trusted/app-preload.cjs'
type OpenHandler = (details: HandlerDetails) => WindowOpenHandlerResponse
type NativeOptions = BrowserWindowConstructorOptions & { webContents?: WebContents }

class Contents extends EventEmitter {
  url = APP
  destroyed = false
  handler: OpenHandler = () => ({ action: 'deny' })
  setWindowOpenHandler = vi.fn((handler: OpenHandler) => { this.handler = handler })
  close = vi.fn((_options: { waitForBeforeUnload: boolean }) => {
    this.destroyed = true
    this.emit('destroyed')
  })

  getURL() { return this.url }
  isDestroyed() { return this.destroyed }
  native() { return this as unknown as WebContents }
}

class Window extends EventEmitter {
  destroyed = false
  readonly focus = vi.fn()
  readonly close = vi.fn()
  readonly destroy = vi.fn(() => {
    this.destroyed = true
    this.webContents.destroyed = true
    this.webContents.emit('destroyed')
    this.emit('closed')
  })

  constructor(readonly webContents = new Contents()) { super() }
  isDestroyed() { return this.destroyed }
  native() { return this as unknown as BrowserWindow }
}

function details(overrides: Partial<HandlerDetails> = {}): HandlerDetails {
  return {
    url: TARGET, frameName: NAME, features: 'popup=yes,width=400,height=300',
    disposition: 'new-window', referrer: { url: APP, policy: 'strict-origin-when-cross-origin' },
    ...overrides,
  }
}

function navigation(url = APP, isMainFrame = true, isSameDocument = false) {
  return { url, isMainFrame, isSameDocument, frame: null, preventDefault: vi.fn() }
}

function harness(url = APP, allowed = () => true) {
  const owner = new Window()
  owner.webContents.url = url
  const windows: Window[] = []
  const factory = vi.fn((options: BrowserWindowConstructorOptions): BrowserWindow => {
    const contents = (options as NativeOptions).webContents as unknown as Contents
    const child = new Window(contents)
    windows.push(child)
    return child.native()
  })
  const policy = installFloatingWindowPolicy(owner.native(), PRELOAD, factory, allowed)
  const admit = (overrides: Partial<HandlerDetails> = {}) => owner.webContents.handler(details(overrides))
  function create(response = admit(), guest = new Contents(), extra: NativeOptions = {}) {
    expect(response.action).toBe('allow')
    if (response.createWindow === undefined) throw new Error('missing admitted native constructor')
    const options = { ...response.overrideBrowserWindowOptions, ...extra, webContents: guest.native() }
    const returned = response.createWindow(options)
    expect(returned).toBe(guest.native())
    const child = windows.at(-1)
    if (child === undefined) throw new Error('native child was not created')
    return child
  }
  return { owner, windows, factory, policy, admit, create }
}

describe('floating native app admission', () => {
  it('denies new windows and pending native creation while main-owned updates block admission', () => {
    let allowed = false
    const run = harness(APP, () => allowed)
    expect(run.admit()).toEqual({ action: 'deny' })
    allowed = true
    const pending = run.admit()
    allowed = false
    const guest = new Contents()
    expect(() => run.create(pending, guest)).toThrow('admission expired')
    expect(guest.close).toHaveBeenCalledOnce()
    expect(run.factory).not.toHaveBeenCalled()
    allowed = true
    run.create()
    expect(run.factory).toHaveBeenCalledOnce()
  })

  it.each([
    APP, '', 'about:blank', 'https://app/index.html', 'http://127.0.0.1/index.html', 'javascript:alert(1)',
    'dsh-app://shell/index.html', 'dsh-app://app/', 'dsh-app://app/other.html', 'dsh-app://app/./index.html',
    'dsh-app://user@app/index.html', 'dsh-app://user:secret@app/index.html', 'dsh-app://app:80/index.html',
    'dsh-app://app.evil/index.html', 'DSH-APP://app/index.html', 'dsh-app://APP/index.html',
  ].filter(url => url !== APP))('denies a target outside the exact app route: %s', (url) => {
    const { admit, factory } = harness()
    expect(admit({ url: url + QUERY })).toEqual({ action: 'deny' })
    expect(factory).not.toHaveBeenCalled()
  })

  it.each([
    APP + '?', APP + '#', APP + '?token=secret', APP + '?dsh-floating-workspace=1',
    APP + '?dsh-floating-owner=' + OWNER,
    TARGET, 'dsh-app://shell/index.html', 'dsh-app://app/other.html',
    'dsh-app://user:secret@app/index.html', 'dsh-app://app:80/index.html', 'https://app/index.html',
    'dsh-app://app/index.html\n', 'DSH-APP://app/index.html', 'dsh-app://APP/index.html',
  ])('denies every opener other than the exact main document: %s', (url) => {
    const { admit, factory } = harness(url)
    expect(admit()).toEqual({ action: 'deny' })
    expect(factory).not.toHaveBeenCalled()
  })

  it.each([
    APP, TARGET + '#', TARGET + '#section', TARGET + '&token=secret', TARGET + '&access_token=secret',
    TARGET + '&preload=evil.js', TARGET + '&dsh-floating-workspace=1', TARGET + '&dsh-floating-owner=' + OWNER,
    TARGET + '&%64sh-floating-owner=' + OWNER, TARGET + '&dsh-floating-session=one&dsh-floating-session=two',
    TARGET + '&dsh-floating-session=', TARGET + '&dsh-floating-session=' + 'a'.repeat(513),
    TARGET + '&dsh-floating-session=%00', TARGET + '&dsh-floating-session=%0A',
    TARGET + '&dsh-floating-session=%7F', TARGET + '&dsh-floating-session=%C2%85',
    TARGET + '\n', TARGET.replace('workspace=1', 'workspace=true'), TARGET.replace('workspace=1', 'workspace=01'),
    TARGET.replace(OWNER, OWNER.toUpperCase()), TARGET.replace(OWNER, 'not-a-uuid'), TARGET.replace(OWNER, OWNER + 'extra'),
    TARGET + '&sessionId=unowned', TARGET + '&dsh-floating-unknown=value', TARGET + '&=value',
  ])('rejects duplicate, secret-bearing, malformed, or unsupported query fields: %s', (url) => {
    const { admit } = harness()
    expect(admit({ url })).toEqual({ action: 'deny' })
  })

  it.each(['', '_blank', 'workspace', NAME + '-extra', 'dsh-floating-workspace-' + OTHER, NAME.toUpperCase()])(
    'rejects a window name not bound to the route owner: %s', (frameName) => {
      expect(harness().admit({ frameName })).toEqual({ action: 'deny' })
    },
  )

  it.each([
    '', 'width=400,height=300', 'popup=no,width=400,height=300', 'popup=yes,height=300,width=400',
    'popup=yes,width=199,height=300', 'popup=yes,width=801,height=300',
    'popup=yes,width=400,height=149', 'popup=yes,width=400,height=601',
    'popup=yes,width=400.0,height=300', 'popup=yes,width=0400,height=300', 'popup=yes,width=+400,height=300',
    'popup=yes,width=4e2,height=300', 'popup=yes,width=Infinity,height=300', 'popup=yes,width=400, height=300',
    'popup=yes,width=400,height=300,nodeIntegration=yes', 'popup=yes,width=400,height=300,preload=/evil.js',
    'popup=yes,width=400,height=300,sandbox=no', 'popup=yes,width=400,height=300,width=800',
    'popup=yes,width=400,height=300,noopener', 'popup=yes,width=400,height=300,',
  ])('rejects noncanonical or out-of-bounds features: %s', (features) => {
    expect(harness().admit({ features })).toEqual({ action: 'deny' })
  })

  it.each(['default', 'foreground-tab', 'background-tab', 'other'] as const)('rejects %s disposition', (disposition) => {
    expect(harness().admit({ disposition })).toEqual({ action: 'deny' })
  })

  it('rejects form post bodies, including an empty body', () => {
    expect(harness().admit({ postBody: { contentType: 'application/x-www-form-urlencoded', data: [] } })).toEqual({ action: 'deny' })
  })

  it.each(['https://evil.example', TARGET, APP + '?token=secret', APP + '#', 'dsh-app://app/'])('rejects unowned referrer %s', (url) => {
    expect(harness().admit({ referrer: { url, policy: 'unsafe-url' } })).toEqual({ action: 'deny' })
  })

  it.each(['', APP])('admits owned or absent referrers without forwarding other data: %s', (url) => {
    expect(harness().admit({ referrer: { url, policy: 'no-referrer' } }).action).toBe('allow')
  })

  it.each([undefined, 'listed-session', 'folder/session:一', 'x'.repeat(512)])('accepts a bounded printable catalog id: %s', (session) => {
    const params = new URLSearchParams()
    if (session !== undefined) params.set('dsh-floating-session', session)
    params.set('dsh-floating-owner', OWNER)
    params.set('dsh-floating-workspace', '1')
    expect(harness().admit({ url: APP + '?' + params.toString() }).action).toBe('allow')
  })

  it.each([[200, 150], [400, 300], [800, 600]])('seals the %ix%i native child options and preserves only the native contents', (width, height) => {
    const { owner, admit, create, factory } = harness()
    const response = admit({ features: 'popup=yes,width=' + String(width) + ',height=' + String(height) })
    const expected = {
      width, height, minWidth: 200, minHeight: 150, parent: owner.native(), show: true,
      webPreferences: {
        preload: PRELOAD, sandbox: true, contextIsolation: true, webSecurity: true,
        nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
        webviewTag: false, allowRunningInsecureContent: false, navigateOnDragDrop: false,
      },
    }
    expect(response).toEqual({ action: 'allow', outlivesOpener: false, overrideBrowserWindowOptions: expected,
      createWindow: expect.any(Function) as unknown })
    const guest = new Contents()
    const child = create(response, guest, {
      parent: new Window().native(), width: 1800, minWidth: 880, height: 1000, minHeight: 660, alwaysOnTop: true,
      webPreferences: { preload: '/evil.js', nodeIntegration: true, sandbox: false, webSecurity: false, partition: 'unowned' },
    })
    expect(factory).toHaveBeenCalledExactlyOnceWith({ ...expected, webContents: guest.native() })
    expect(child.webContents.handler(details())).toEqual({ action: 'deny' })
  })
})

describe('floating child navigation', () => {
  it.each(['will-navigate', 'will-redirect'])('allows only the same child identity on %s', (eventName) => {
    const { create, admit } = harness()
    const child = create(admit({ url: TARGET + '&dsh-floating-session=one' }))
    for (const url of [TARGET + '&dsh-floating-session=one',
      APP + '?dsh-floating-session=one&dsh-floating-owner=' + OWNER + '&dsh-floating-workspace=1']) {
      const event = navigation(url)
      child.webContents.emit(eventName, event)
      expect(event.preventDefault).not.toHaveBeenCalled()
    }
    for (const url of [APP, APP + '?token=secret', 'dsh-app://shell/index.html', 'https://evil.example',
      TARGET.replace(OWNER, OTHER), TARGET, TARGET + '&dsh-floating-session=two',
      TARGET + '&dsh-floating-session=one#fragment', TARGET + '&dsh-floating-session=one&other=1']) {
      const event = navigation(url)
      child.webContents.emit(eventName, event)
      expect(event.preventDefault).toHaveBeenCalledOnce()
    }
    const subframe = navigation('https://subframe.example', false)
    child.webContents.emit(eventName, subframe)
    expect(subframe.preventDefault).not.toHaveBeenCalled()
  })

  it('keeps child popup recursion denied through its whole lifetime', () => {
    const { create, policy } = harness()
    const child = create()
    expect(child.webContents.handler(details())).toEqual({ action: 'deny' })
    expect(child.webContents.handler(details({ url: APP }))).toEqual({ action: 'deny' })
    policy.dispose()
    expect(child.webContents.handler(details())).toEqual({ action: 'deny' })
  })
})

describe('floating opener ownership and lifecycle', () => {
  it('reserves one creation before constructing and allows a replacement after the child closes', () => {
    const { owner, admit, create, factory } = harness()
    const response = admit()
    expect(admit()).toEqual({ action: 'deny' })
    expect(factory).not.toHaveBeenCalled()
    const first = create(response)
    expect(admit()).toEqual({ action: 'deny' })
    first.destroy()
    expect(owner.focus).toHaveBeenCalledOnce()
    expect(first.webContents.listenerCount('will-navigate')).toBe(0)
    expect(first.webContents.listenerCount('will-redirect')).toBe(0)
    const second = create()
    expect(second).not.toBe(first)
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('destroys only the exact child despite beforeunload and is reusable after close', () => {
    const { owner, create, policy } = harness()
    const unrelated = new Window()
    const child = create()
    child.close.mockImplementation(() => { throw new Error('renderer refuses beforeunload') })
    policy.close()
    policy.close()
    expect(child.destroy).toHaveBeenCalledOnce()
    expect(child.close).not.toHaveBeenCalled()
    expect(unrelated.destroy).not.toHaveBeenCalled()
    expect(owner.destroy).not.toHaveBeenCalled()
    expect(owner.focus).toHaveBeenCalledOnce()
    expect(create()).not.toBe(child)
  })

  it('keeps separate openers and their exact children independent', () => {
    const first = harness(), second = harness()
    const firstChild = first.create(), secondChild = second.create()
    first.policy.dispose()
    expect(firstChild.destroy).toHaveBeenCalledOnce()
    expect(secondChild.destroy).not.toHaveBeenCalled()
    expect(second.owner.focus).not.toHaveBeenCalled()
    expect(second.admit()).toEqual({ action: 'deny' })
  })

  it('closes on main reload and blocks creation until the document finishes loading', () => {
    const { owner, create, admit } = harness()
    const child = create()
    owner.webContents.emit('did-start-navigation', navigation())
    expect(child.destroy).toHaveBeenCalledOnce()
    expect(admit()).toEqual({ action: 'deny' })
    owner.webContents.emit('did-finish-load')
    expect(create()).not.toBe(child)
  })

  it('closes on same-document main navigation but leaves subframe navigation alone', () => {
    const { owner, create } = harness()
    const child = create()
    owner.webContents.emit('did-start-navigation', navigation('dsh-app://app/frame.html', false))
    expect(child.destroy).not.toHaveBeenCalled()
    owner.webContents.emit('did-start-navigation', navigation(APP, true, true))
    expect(child.destroy).toHaveBeenCalledOnce()
    expect(create()).not.toBe(child)
  })

  it('never reopens from a shell route after main navigation has completed', () => {
    const { owner, create, admit } = harness()
    const child = create()
    owner.webContents.emit('did-start-navigation', navigation('dsh-app://shell/index.html'))
    owner.webContents.url = 'dsh-app://shell/index.html'
    owner.webContents.emit('did-finish-load')
    expect(child.destroy).toHaveBeenCalledOnce()
    expect(admit()).toEqual({ action: 'deny' })
  })

  it.each(['closed', 'contents-destroyed', 'render-process-gone'])('destroys its child on owner %s', (reason) => {
    const { owner, create, admit } = harness()
    const child = create()
    if (reason === 'closed') owner.destroy()
    else if (reason === 'contents-destroyed') owner.webContents.close({ waitForBeforeUnload: false })
    else owner.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    expect(child.destroy).toHaveBeenCalledOnce()
    if (reason !== 'render-process-gone') {
      expect(owner.focus).not.toHaveBeenCalled()
      expect(admit()).toEqual({ action: 'deny' })
    }
  })

  it('does not focus an opener destroyed before a native child close', () => {
    const { owner, create } = harness()
    const child = create()
    owner.destroyed = true
    child.destroy()
    expect(owner.focus).not.toHaveBeenCalled()
  })

  it('disposes idempotently, removes listeners, and leaves a deny-only handler', () => {
    const { owner, create, policy, admit } = harness()
    const unrelatedListener = vi.fn()
    owner.webContents.on('did-finish-load', unrelatedListener)
    const child = create()
    policy.dispose()
    policy.dispose()
    expect(child.destroy).toHaveBeenCalledOnce()
    expect(admit()).toEqual({ action: 'deny' })
    expect(owner.listenerCount('closed')).toBe(0)
    for (const name of ['did-start-navigation', 'destroyed', 'render-process-gone']) {
      expect(owner.webContents.listenerCount(name)).toBe(0)
    }
    expect(child.eventNames()).toEqual([])
    expect(child.webContents.eventNames()).toEqual([])
    owner.webContents.emit('did-finish-load')
    expect(unrelatedListener).toHaveBeenCalledOnce()
  })

  it('reinstalls on the same opener without stale listeners or a stale disposer overriding the replacement', () => {
    const { owner, create, factory, policy, admit } = harness()
    const first = create()
    const replacement = installFloatingWindowPolicy(owner.native(), PRELOAD, factory)
    expect(first.destroy).toHaveBeenCalledOnce()
    expect(owner.webContents.listenerCount('did-start-navigation')).toBe(1)
    policy.dispose()
    const second = create(admit())
    policy.close()
    expect(second.destroy).not.toHaveBeenCalled()
    replacement.dispose()
    expect(second.destroy).toHaveBeenCalledOnce()
    expect(admit()).toEqual({ action: 'deny' })
  })

  it.each(['close', 'dispose', 'reload', 'closed', 'url-change', 'reinstall'])('rejects pending creation after %s without constructing', (reason) => {
    const { owner, admit, policy, factory } = harness()
    const response = admit()
    if (reason === 'close') policy.close()
    else if (reason === 'dispose') policy.dispose()
    else if (reason === 'reload') owner.webContents.emit('did-start-navigation', navigation())
    else if (reason === 'closed') owner.destroy()
    else if (reason === 'url-change') owner.webContents.url = 'dsh-app://shell/index.html'
    else installFloatingWindowPolicy(owner.native(), PRELOAD, factory)
    const guest = new Contents()
    expect(() => response.createWindow?.({ webContents: guest.native() } as NativeOptions)).toThrow('expired')
    expect(factory).not.toHaveBeenCalled()
    expect(guest.close).toHaveBeenCalledExactlyOnceWith({ waitForBeforeUnload: false })
  })

  it('does not let an expired callback cancel a newer reservation', () => {
    const { policy, admit, create } = harness()
    const stale = admit()
    policy.close()
    const fresh = admit()
    const guest = new Contents()
    expect(() => stale.createWindow?.({ webContents: guest.native() } as NativeOptions)).toThrow('expired')
    expect(create(fresh).destroy).not.toHaveBeenCalled()
  })

  it('rejects missing native contents and releases the reservation for the next attempt', () => {
    const { admit, create, factory } = harness()
    const response = admit()
    expect(() => response.createWindow?.({})).toThrow('requires native child WebContents')
    expect(factory).not.toHaveBeenCalled()
    expect(create().destroy).not.toHaveBeenCalled()
  })

  it('rolls back a constructor failure and permits the next user attempt', () => {
    const { admit, factory, create } = harness()
    factory.mockImplementationOnce(() => { throw new Error('native constructor failed') })
    const response = admit(), guest = new Contents()
    expect(() => response.createWindow?.({ webContents: guest.native() } as NativeOptions)).toThrow('native constructor failed')
    expect(guest.close).toHaveBeenCalledExactlyOnceWith({ waitForBeforeUnload: false })
    expect(create().destroy).not.toHaveBeenCalled()
  })

  it('destroys a child created during a reentrant owner disposal and never publishes it', () => {
    const { admit, policy, factory, owner } = harness()
    const guest = new Contents(), nativeChild = new Window(guest)
    factory.mockImplementationOnce(() => { policy.dispose(); return nativeChild.native() })
    const response = admit()
    expect(() => response.createWindow?.({ webContents: guest.native() } as NativeOptions)).toThrow('owner changed')
    expect(nativeChild.destroy).toHaveBeenCalledOnce()
    expect(guest.close).not.toHaveBeenCalled()
    expect(owner.focus).not.toHaveBeenCalled()
    expect(admit()).toEqual({ action: 'deny' })
  })

  it('rolls back failed child restrictions without retaining a child pointer', () => {
    const { admit, create } = harness()
    const guest = new Contents()
    guest.setWindowOpenHandler.mockImplementationOnce(() => { throw new Error('child contents destroyed') })
    expect(() => create(admit(), guest)).toThrow('child contents destroyed')
    expect(guest.destroyed).toBe(true)
    expect(guest.eventNames()).toEqual([])
    expect(create().destroy).not.toHaveBeenCalled()
  })

  it('does not create a second window when Electron repeats an admitted callback', () => {
    const { admit, create, factory } = harness()
    const response = admit()
    const child = create(response)
    const duplicateGuest = new Contents()
    expect(() => response.createWindow?.({ webContents: duplicateGuest.native() } as NativeOptions)).toThrow('expired')
    expect(factory).toHaveBeenCalledOnce()
    expect(child.destroy).not.toHaveBeenCalled()
    expect(duplicateGuest.close).toHaveBeenCalledExactlyOnceWith({ waitForBeforeUnload: false })
  })

  it('keeps the reservation while the native factory reenters admission', () => {
    const { admit, create, factory } = harness()
    const construct = factory.getMockImplementation()!
    factory.mockImplementationOnce((options) => {
      expect(admit()).toEqual({ action: 'deny' })
      return construct(options)
    })
    expect(create().destroy).not.toHaveBeenCalled()
    expect(factory).toHaveBeenCalledOnce()
  })

  it('does not clear a replacement when an earlier closed listener replaces the child', () => {
    const { factory, policy, admit, create, owner } = harness()
    const guest = new Contents(), first = new Window(guest)
    let replacement: Window | undefined
    first.on('closed', () => { policy.close(); replacement = create() })
    factory.mockImplementationOnce(() => first.native())
    admit().createWindow?.({ webContents: guest.native() } as NativeOptions)
    first.destroy()
    expect(first.destroy).toHaveBeenCalledOnce()
    expect(replacement).toBeDefined()
    expect(replacement?.destroy).not.toHaveBeenCalled()
    expect(owner.focus).toHaveBeenCalledOnce()
    expect(admit()).toEqual({ action: 'deny' })
    policy.close()
    expect(replacement?.destroy).toHaveBeenCalledOnce()
  })

  it('retains a policy installed by a child closed listener during disposal', () => {
    const { owner, create, factory, policy, admit } = harness()
    const child = create()
    child.on('closed', () => { installFloatingWindowPolicy(owner.native(), PRELOAD, factory) })
    policy.dispose()
    const replacement = create(admit())
    expect(owner.webContents.listenerCount('did-start-navigation')).toBe(1)
    installFloatingWindowPolicy(owner.native(), PRELOAD, factory)
    expect(replacement.destroy).toHaveBeenCalledOnce()
    expect(owner.webContents.listenerCount('did-start-navigation')).toBe(1)
  })

  it('does not activate a policy for an already destroyed owner', () => {
    const owner = new Window()
    owner.destroy()
    const factory = vi.fn()
    const policy = installFloatingWindowPolicy(owner.native(), PRELOAD, factory)
    policy.close()
    policy.dispose()
    expect(factory).not.toHaveBeenCalled()
    expect(owner.webContents.setWindowOpenHandler).not.toHaveBeenCalled()
    expect(owner.eventNames()).toEqual([])
    expect(owner.webContents.eventNames()).toEqual([])
  })
})
