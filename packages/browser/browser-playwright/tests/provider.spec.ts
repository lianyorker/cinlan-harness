/* oxlint-disable typescript/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
import { Context } from '@deepseek-ai/cordis'
import { Readable } from 'node:stream'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import BrowserRuntime, {
  BrowserElementId,
  BrowserError,
  BrowserObservationId,
  BrowserPageId,
} from '@deepseek-ai/dsh-browser'
import { chromium } from 'playwright-core'
import type { Browser, BrowserContext, ElementHandle, Locator, Page } from 'playwright-core'
import { describe, expect, it, vi } from 'vitest'
import {
  PlaywrightBrowserProvider,
  resolvePlaywrightBrowserConfig,
} from '../src/index.ts'
import * as PlaywrightBrowser from '../src/index.ts'
import BrowserRuntimeManager from '../src/runtime.ts'
import { runtimeMetadata } from '../src/runtime-metadata.ts'

/** Install one managed Chromium generation so the runtime can resolve its executable. */
async function installManagedChromium(storageDir: string): Promise<void> {
  const directory = join(storageDir, 'generation-fixture')
  const executable = join(directory, runtimeMetadata.executableRelative)
  const marker = join(directory, runtimeMetadata.markerRelative)
  await mkdir(dirname(executable), { recursive: true })
  await mkdir(dirname(marker), { recursive: true })
  await writeFile(executable, 'fixture')
  await writeFile(marker, '')
  await writeFile(join(storageDir, 'active-' + runtimeMetadata.revision + '.json'), JSON.stringify('generation-fixture'))
}

interface FakeItemValues {
  readonly role?: string
  readonly label?: string
  readonly title?: string
  readonly text?: string | null
  readonly tag: string
  readonly visible?: boolean | 'reject'
  readonly handle?: boolean
}

interface FakeFingerprint {
  readonly tagName: string
  readonly role: string
  readonly name: string
  readonly text: string
  /** Explicit aria-label; null keeps the attribute absent so the title and text fallbacks run. */
  readonly ariaLabel?: string | null
  /** Explicit title attribute. */
  readonly title?: string | null
}

interface FakeBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

class FakeElement {
  clickFailure: unknown
  evaluateFailure: unknown
  boundingBoxFailure: Error | undefined
  uploadFailure: unknown
  fingerprints: FakeFingerprint[] = [{ tagName: 'button', role: 'button', name: 'Continue', text: 'Continue' }]
  boxes: Array<FakeBox | null> = [{ x: 10, y: 20, width: 30, height: 40 }]
  readonly uploads: Array<{ readonly name: string; readonly mimeType: string; readonly buffer: Buffer }> = []
  readonly click = vi.fn(async () => {
    if (this.clickFailure !== undefined) throw this.clickFailure
  })
  readonly dispose = vi.fn(() => Promise.resolve())
  readonly setInputFiles = vi.fn(async (payload: { name: string; mimeType: string; buffer: Buffer }) => {
    if (this.uploadFailure !== undefined) throw this.uploadFailure
    this.uploads.push(payload)
  })
  readonly boundingBox = vi.fn(async () => {
    if (this.boundingBoxFailure !== undefined) throw this.boundingBoxFailure
    const value = this.boxes.length > 1 ? this.boxes.shift() : this.boxes[0]
    return value ?? null
  })
  evaluate<T>(callback: (node: Element) => T): Promise<T> {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- non-Error page failures are the behavior under test.
    if (this.evaluateFailure !== undefined) return Promise.reject(this.evaluateFailure)
    const value = this.fingerprints.length > 1 ? this.fingerprints.shift() : this.fingerprints[0]
    if (value === undefined) return Promise.reject(new Error('missing fake element fingerprint'))
    const node = {
      tagName: value.tagName.toUpperCase(),
      getAttribute: (name: string) => name === 'role'
        ? (value.role === '' ? null : value.role)
        : name === 'aria-label'
          ? (value.ariaLabel === undefined ? value.name : value.ariaLabel)
          : name === 'title' ? value.title ?? null : null,
      textContent: value.text,
    } as unknown as Element
    return Promise.resolve(callback(node))
  }
}

class FakeItem {
  constructor(readonly element: FakeElement, readonly values: FakeItemValues) {}
  isVisible(): Promise<boolean> {
    return this.values.visible === 'reject'
      ? Promise.reject(new Error('visibility failed'))
      : Promise.resolve(this.values.visible ?? true)
  }
  elementHandle(): Promise<ElementHandle | null> {
    return Promise.resolve(this.values.handle === false ? null : this.element as unknown as ElementHandle)
  }
  evaluate<T>(callback: (node: { tagName: string }) => T): Promise<T> {
    return Promise.resolve(callback({ tagName: this.values.tag.toUpperCase() }))
  }
  getAttribute(name: string): Promise<string | null> {
    const value = name === 'role' ? this.values.role : name === 'aria-label' ? this.values.label : this.values.title
    return Promise.resolve(value ?? null)
  }
  textContent(): Promise<string | null> { return Promise.resolve(this.values.text ?? null) }
}

class FakeLocator {
  constructor(
    readonly body: boolean,
    readonly items: readonly FakeItem[],
    readonly ariaFailure?: Error,
  ) {}
  ariaSnapshot(): Promise<string> {
    return this.ariaFailure === undefined
      ? Promise.resolve('- document "Fixture"')
      : Promise.reject(this.ariaFailure)
  }
  count(): Promise<number> { return Promise.resolve(this.items.length) }
  nth(index: number): Locator { return this.items[index] as unknown as Locator }
  elementHandle(): Promise<ElementHandle | null> {
    const item = this.items[0]
    return Promise.resolve(item === undefined || item.values.handle === false
      ? null
      : item.element as unknown as ElementHandle)
  }
}

/** One in-page node the injected overlay scripts read and mutate. */
class FakeDomNode {
  readonly attributes = new Map<string, string>()
  readonly style: Record<string, string> = {}
  readonly children: FakeDomNode[] = []
  id = ''
  textContent: string
  rect: FakeBox = { x: 0, y: 0, width: 0, height: 0 }
  removed = false
  constructor(readonly tagName: string, textContent = '') { this.textContent = textContent }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  removeAttribute(name: string): void { this.attributes.delete(name) }
  getBoundingClientRect(): FakeBox { return this.rect }
  append(child: FakeDomNode): void { this.children.push(child) }
  remove(): void { this.removed = true }
}

/** One dispatched in-page event; the key field carries the Escape decision for keydown. */
class FakeDomEvent {
  defaultPrevented = false
  propagationStopped = false
  immediateStopped = false
  constructor(readonly target: unknown, readonly key = '') {}
  preventDefault(): void { this.defaultPrevented = true }
  stopPropagation(): void { this.propagationStopped = true }
  stopImmediatePropagation(): void { this.immediateStopped = true }
}

/** Minimal window/document pair the injected overlay scripts run against. */
class FakeDom {
  readonly documentElement = new FakeDomNode('html')
  readonly nodes: FakeDomNode[] = []
  readonly listeners = new Map<string, ((event: FakeDomEvent) => void)[]>()
  readonly window: { __dshBrowserElementCapture?: { key: string; cleanup(): void }; innerWidth: number; innerHeight: number } = {
    innerWidth: 800,
    innerHeight: 600,
  }
  private restoreGlobals: (() => void) | undefined

  /** Install the page globals the injected scripts resolve at call time. */
  install(): void {
    const globals = globalThis as unknown as Record<string, unknown>
    const saved = new Map<string, { present: boolean; value: unknown }>()
    for (const key of ['window', 'document', 'Element', 'innerWidth', 'innerHeight']) {
      saved.set(key, { present: Object.hasOwn(globals, key), value: globals[key] })
    }
    globals.window = this.window
    globals.document = this.document
    globals.Element = FakeDomNode
    globals.innerWidth = this.window.innerWidth
    globals.innerHeight = this.window.innerHeight
    this.restoreGlobals = () => {
      for (const [key, entry] of saved) {
        if (entry.present) globals[key] = entry.value
        else Reflect.deleteProperty(globals, key)
      }
    }
  }
  restore(): void {
    this.restoreGlobals?.()
    this.restoreGlobals = undefined
  }
  /** Execute one in-page callback the provider passed to page.evaluate. */
  run<T>(callback: (argument?: unknown) => T, argument?: unknown): Promise<T> {
    return Promise.resolve(callback(argument))
  }
  readonly document = {
    documentElement: this.documentElement,
    createElement: (tagName: string): FakeDomNode => this.create(tagName),
    addEventListener: (type: string, listener: (event: FakeDomEvent) => void): void => {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
    },
    removeEventListener: (type: string, listener: (event: FakeDomEvent) => void): void => {
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter(entry => entry !== listener))
    },
    querySelectorAll: (): FakeDomNode[] => this.nodes.filter(node => node.attributes.has('data-dsh-browser-element')),
  }

  create(tagName: string, textContent = ''): FakeDomNode {
    const node = new FakeDomNode(tagName, textContent)
    this.nodes.push(node)
    return node
  }
  dispatch(type: string, event: FakeDomEvent): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event)
  }
  overlay(): FakeDomNode | undefined {
    return this.nodes.find(node => node.id === '__dsh_browser_element_capture_overlay__')
  }
  captureKey(): string | undefined { return this.window.__dshBrowserElementCapture?.key }
}

class FakePage {
  readonly frame = {}
  readonly element = new FakeElement()
  readonly listeners = new Map<string, ((value: unknown) => void)[]>()
  readonly evaluateNames: string[] = []
  readonly removedMarkerKeys: string[] = []
  items: FakeItem[] = [
    new FakeItem(this.element, { role: 'button', label: 'Continue', text: 'Continue', tag: 'button' }),
  ]
  selectionItems: FakeItem[] = this.items
  overlaySelection: Omit<FakeFingerprint & { readonly rect: FakeBox }, 'key'> | null = {
    tagName: 'button', role: 'button', name: 'Continue', text: 'Continue',
    rect: { x: 10, y: 20, width: 30, height: 40 },
  }
  overlayFailure: Error | undefined
  removeMarkerFailure: Error | undefined
  clearOverlayFailure: Error | undefined
  viewportFailure: Error | undefined
  overlayCleanupCalls = 0
  ariaFailure: Error | undefined
  gotoFailure: Error | undefined
  backUrl: string | undefined
  forwardUrl: string | undefined
  backFailure: unknown
  forwardFailure: unknown
  /** When set, page scripts run for real against this in-page DOM instead of canned results. */
  dom: FakeDom | undefined
  screenshotFailure: unknown
  screenshotPending: Promise<Buffer> | undefined
  closeFailure: Error | undefined
  private readonly overlayResolvers = new Map<string, (value: unknown) => void>()
  private activeOverlayKey: string | undefined
  private holdSelections = false
  readonly goto = vi.fn(async (url: string) => {
    if (this.gotoFailure !== undefined) throw this.gotoFailure
    this.currentUrl = url
    this.emit('framenavigated', this.frame)
    return null
  })
  readonly goBack = vi.fn(async () => {
    if (this.backFailure !== undefined) throw this.backFailure
    if (this.backUrl !== undefined) {
      this.currentUrl = this.backUrl
      this.emit('framenavigated', this.frame)
    }
    return null
  })
  readonly goForward = vi.fn(async () => {
    if (this.forwardFailure !== undefined) throw this.forwardFailure
    if (this.forwardUrl !== undefined) {
      this.currentUrl = this.forwardUrl
      this.emit('framenavigated', this.frame)
    }
    return null
  })
  readonly screenshot = vi.fn(async (_options?: unknown) => {
    if (this.screenshotFailure !== undefined) throw this.screenshotFailure
    if (this.screenshotPending !== undefined) return this.screenshotPending
    return Buffer.from([1, 2, 3])
  })
  readonly close = vi.fn(async () => {
    if (this.closeFailure !== undefined) throw this.closeFailure
    this.closed = true
    this.emit('close', undefined)
  })
  private currentUrl = 'about:blank'
  private closed = false

  beginPendingSelection(): void {
    this.holdSelections = true
  }
  /** Settle the pending overlay with one fabricated selection, as a page click would. */
  completeSelection(): void {
    const key = this.activeOverlayKey
    if (key === undefined) throw new Error('no pending selection overlay')
    this.activeOverlayKey = undefined
    const value = this.overlaySelection === null ? null : { ...this.overlaySelection, key }
    this.overlayResolvers.get(key)?.(value)
    this.overlayResolvers.delete(key)
  }
  on(event: string, listener: (value: unknown) => void): this {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
    return this
  }
  emit(event: string, value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value)
  }
  url(): string { return this.currentUrl }
  title(): Promise<string> { return Promise.resolve('Fixture') }
  isClosed(): boolean { return this.closed }
  mainFrame(): object { return this.frame }
  evaluate<T, A>(callback: ((argument: A) => T) | (() => T), argument?: A): Promise<T> {
    this.evaluateNames.push(callback.name)
    if (this.dom !== undefined) return this.dom.run(callback as (argument?: unknown) => T, argument)
    if (callback.name === 'selectElementInPage') {
      if (this.overlayFailure !== undefined) return Promise.reject(this.overlayFailure)
      const key = String(argument)
      if (this.activeOverlayKey !== undefined) {
        this.overlayResolvers.get(this.activeOverlayKey)?.(null)
        this.overlayResolvers.delete(this.activeOverlayKey)
      }
      this.activeOverlayKey = key
      if (this.holdSelections) {
        return new Promise<T>((resolve) => {
          this.overlayResolvers.set(key, (value) =>{  resolve(value as T) })
        })
      }
      this.activeOverlayKey = undefined
      const result = this.overlaySelection === null
        ? null
        : { ...this.overlaySelection, key }
      return Promise.resolve(result as T)
    }
    if (callback.name === 'clearElementOverlay') {
      this.overlayCleanupCalls += 1
      const key = String(argument)
      if (this.activeOverlayKey === key) {
        this.overlayResolvers.get(key)?.(null)
        this.overlayResolvers.delete(key)
        this.activeOverlayKey = undefined
      }
      return this.clearOverlayFailure === undefined
        ? Promise.resolve(undefined as T)
        : Promise.reject(this.clearOverlayFailure)
    }
    if (callback.name === 'removeSelectionMarker') {
      this.removedMarkerKeys.push(String(argument))
      if (this.removeMarkerFailure !== undefined) return Promise.reject(this.removeMarkerFailure)
      return Promise.resolve(undefined as T)
    }
    if (this.viewportFailure !== undefined) return Promise.reject(this.viewportFailure)
    return Promise.resolve({ width: 800, height: 600 } as T)
  }
  locator(selector: string): Locator {
    const body = selector === 'body'
    const items = body
      ? []
      : selector.startsWith('[data-dsh-browser-element=') ? this.selectionItems : this.items
    return new FakeLocator(body, items, body ? this.ariaFailure : undefined) as unknown as Locator
  }
}

class FakeContext {
  readonly addCookies = vi.fn(async (_cookies: unknown) => {})
  readonly initial = new FakePage()
  readonly all = [this.initial]
  private readonly closeListeners: (() => void)[] = []
  readonly close = vi.fn(async () => { for (const listener of this.closeListeners) listener() })
  readonly setDefaultTimeout = vi.fn()
  readonly setDefaultNavigationTimeout = vi.fn()
  private readonly pageListeners: ((page: Page) => void)[] = []
  readonly newPage = vi.fn(async (): Promise<Page> => {
    const page = new FakePage()
    this.all.push(page)
    for (const listener of this.pageListeners) listener(page as unknown as Page)
    return page as unknown as Page
  })

  pages(): Page[] { return this.all as unknown as Page[] }
  on(event: string, listener: (page: Page) => void): this {
    if (event === 'page') this.pageListeners.push(listener)
    if (event === 'close') this.closeListeners.push(listener as () => void)
    return this
  }
}

function harness(overrides: Parameters<typeof resolvePlaywrightBrowserConfig>[0] = {}) {
  const context = new FakeContext()
  const input: Parameters<typeof resolvePlaywrightBrowserConfig>[0] = {
    storageDir: 'C:/fixture/profile',
    headless: true,
    actionTimeoutMs: 100,
    navigationTimeoutMs: 100,
  }
  Object.assign(input, overrides)
  const config = resolvePlaywrightBrowserConfig(input)
  const launch = vi.fn((_directory: string, _options: unknown) => Promise.resolve(context as unknown as BrowserContext))
  const provider = new PlaywrightBrowserProvider(config, launch)
  return { context, launch, provider }
}

describe('Browser stored profiles', () => {
  it('lists the selected, default, and stored profiles without launching a browser', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-browser-profiles-'))
    try {
      const storageDir = join(root, 'profile')
      const provider = new PlaywrightBrowserProvider(
        resolvePlaywrightBrowserConfig({ storageDir, profileName: 'default' }),
        () => Promise.reject(new Error('must not launch')),
      )
      expect(PlaywrightBrowser.profileDirectory(storageDir, 'default')).toBe(storageDir)
      expect(PlaywrightBrowser.profileDirectory(storageDir, 'research').replaceAll('\\', '/')).toBe(storageDir.replaceAll('\\', '/') + '/harness-profiles/profile-research')
      expect(PlaywrightBrowser.storedProfileNames(storageDir)).toEqual([])
      expect(provider.listProfiles()).toEqual([{ name: 'default', directory: storageDir, stored: false, current: true }])
      mkdirSync(join(storageDir, 'harness-profiles', 'profile-research'), { recursive: true })
      mkdirSync(join(storageDir, 'harness-profiles', 'not-a-profile'), { recursive: true })
      expect(PlaywrightBrowser.storedProfileNames(storageDir)).toEqual(['research'])
      expect(provider.listProfiles()).toEqual([
        { name: 'default', directory: storageDir, stored: true, current: true },
        { name: 'research', directory: join(storageDir, 'harness-profiles', 'profile-research'), stored: true, current: false },
      ])
      await provider.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('Browser default zoom', () => {
  it('keeps the configured viewport at zoom 1 and scales the layout viewport above it', () => {
    expect(PlaywrightBrowser.browserViewport(1440, 900, 1)).toEqual({ width: 1440, height: 900 })
    expect(PlaywrightBrowser.browserViewport(1440, 900, 2)).toEqual({ width: 720, height: 450 })
    expect(PlaywrightBrowser.browserViewport(3, 3, 5)).toEqual({ width: 1, height: 1 })
  })

  it('reads a live-updatable zoom and rejects values outside the supported range', () => {
    expect(resolvePlaywrightBrowserConfig().zoom).toBe(1)
    expect(resolvePlaywrightBrowserConfig({ zoom: { get: () => 2 } as never }).zoom).toBe(2)
    for (const zoom of [0, 0.2, 5.1, Number.NaN]) {
      expect(() => resolvePlaywrightBrowserConfig({ zoom })).toThrow(/zoom must be between/)
    }
  })

  it('launches a zoomed page at the configured pixel size', async () => {
    const b = harness({ zoom: 1.5 })
    try {
      await b.provider.listPages()
      expect(b.launch.mock.calls[0]?.[1]).toMatchObject({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1.5 })
    } finally { await b.provider.dispose() }
  })

  it('names the loopback endpoint of the debugging port and rejects out-of-range ports', () => {
    expect(PlaywrightBrowser.attachEndpoint(9333)).toBe('http://127.0.0.1:9333')
    for (const port of [80, 65536]) expect(() => PlaywrightBrowser.attachEndpoint(port)).toThrow(/between 1024 and 65535/)
    expect(() => PlaywrightBrowser.attachEndpoint(1.5)).toThrow(/positive safe integer/)
    expect(resolvePlaywrightBrowserConfig({ attach: true, attachPort: 9333 })).toMatchObject({ attach: true, attachPort: 9333 })
    expect(() => resolvePlaywrightBrowserConfig({ attachPort: 80 })).toThrow(/between 1024 and 65535/)
  })

  it('launches without a device scale override at zoom 1', async () => {
    const b = harness()
    try {
      await b.provider.listPages()
      const options = b.launch.mock.calls[0]?.[1] as Record<string, unknown>
      expect(options.viewport).toEqual({ width: 1440, height: 900 })
      expect(Object.hasOwn(options, 'deviceScaleFactor')).toBe(false)
    } finally { await b.provider.dispose() }
  })
})

describe('Playwright browser provider config', () => {
  it('defaults every deployment choice and rejects malformed settings', () => {
    const defaults = resolvePlaywrightBrowserConfig()
    expect(defaults).toMatchObject({
      providerId: 'local',
      browserChannel: 'chrome',
      headless: false,
      actionTimeoutMs: 30_000,
      navigationTimeoutMs: 60_000,
      maxElements: 200,
      viewportWidth: 1440,
      viewportHeight: 900,
      maxCaptureBytes: 10 * 1024 * 1024,
      maxCapturePixels: 4_000_000,
      selectionTimeoutMs: 60_000,
    })
    expect(defaults.storageDir.replaceAll('\\', '/')).toMatch(/\/\.dsh\/browser\/profile$/)
    expect(resolvePlaywrightBrowserConfig({
      providerId: 'fixture',
      storageDir: 'C:/profile',
      browserChannel: 'msedge',
      executablePath: 'C:/Browser/browser.exe',
      headless: true,
      actionTimeoutMs: 1,
      navigationTimeoutMs: 2,
      maxElements: 3,
      viewportWidth: 4,
      viewportHeight: 5,
      maxCaptureBytes: 6,
      maxCapturePixels: 7,
      selectionTimeoutMs: 8,
      profileName: 'default', homePage: 'about:blank', searchEngine: 'google',
      maxHistoryEntries: 100, maxNetworkEntries: 100, maxCookieCount: 100, maxDownloadCount: 20, maxTransferBytes: 4 * 1024 * 1024,
    })).toEqual({
      providerId: 'fixture',
      zoom: 1,
      attach: false,
      attachPort: 9222,
      storageDir: 'C:/profile',
      browserChannel: 'msedge',
      executablePath: 'C:/Browser/browser.exe',
      headless: true,
      actionTimeoutMs: 1,
      navigationTimeoutMs: 2,
      maxElements: 3,
      viewportWidth: 4,
      viewportHeight: 5,
      maxCaptureBytes: 6,
      maxCapturePixels: 7,
      selectionTimeoutMs: 8,
      profileName: 'default', homePage: 'about:blank', searchEngine: 'google',
      maxHistoryEntries: 100, maxNetworkEntries: 100, maxCookieCount: 100, maxDownloadCount: 20, maxTransferBytes: 4 * 1024 * 1024,
    })
    expect(() => resolvePlaywrightBrowserConfig({ providerId: '' })).toThrow(/providerId must be/)
    expect(() => resolvePlaywrightBrowserConfig({ storageDir: ' C:/profile' })).toThrow(/storageDir must be/)
    expect(() => resolvePlaywrightBrowserConfig({ executablePath: ' ' })).toThrow(/executablePath must be/)
    expect(() => resolvePlaywrightBrowserConfig({ browserChannel: 'firefox' as never })).toThrow(/browserChannel/)
    expect(() => resolvePlaywrightBrowserConfig({ maxElements: 0 })).toThrow(/positive safe integer/)
    expect(() => resolvePlaywrightBrowserConfig({ actionTimeoutMs: Number.NaN })).toThrow(/positive safe integer/)
    expect(() => resolvePlaywrightBrowserConfig({ extra: true } as never)).toThrow(/unsupported config key/)
    expect(() => resolvePlaywrightBrowserConfig({ homePage: 'http://' })).toThrow(/must be an HTTP or HTTPS URL/)
    expect(() => resolvePlaywrightBrowserConfig({ homePage: 'https://example.test/' + 'a'.repeat(8192) })).toThrow(/homePage is too long/)
    expect(() => resolvePlaywrightBrowserConfig({ maxTransferBytes: 100 * 1024 * 1024 + 1 })).toThrow(/maxTransferBytes exceeds 100 MiB/)
    expect(() => resolvePlaywrightBrowserConfig({ maxNetworkEntries: 1001 })).toThrow(/maxNetworkEntries must not exceed 1000/)
    expect(() => resolvePlaywrightBrowserConfig({ searchEngine: 'ask' as never })).toThrow(/searchEngine is invalid/)
  })

  it('reads the remote debugging port from the environment only when the configuration omits it', () => {
    vi.stubEnv('CLH_BROWSER_CDP_PORT', '9444')
    vi.stubEnv('DSH_BROWSER_CDP_PORT', '9222')
    try {
      expect(resolvePlaywrightBrowserConfig().remoteDebuggingPort).toBe(9444)
      vi.stubEnv('CLH_BROWSER_CDP_PORT', '')
      expect(resolvePlaywrightBrowserConfig().remoteDebuggingPort).toBeUndefined()
      vi.stubEnv('CLH_BROWSER_CDP_PORT', undefined)
      expect(resolvePlaywrightBrowserConfig().remoteDebuggingPort).toBe(9222)
      vi.stubEnv('DSH_BROWSER_CDP_PORT', '')
      expect(resolvePlaywrightBrowserConfig().remoteDebuggingPort).toBeUndefined()
      expect(resolvePlaywrightBrowserConfig({ remoteDebuggingPort: 9555 }).remoteDebuggingPort).toBe(9555)
    } finally { vi.unstubAllEnvs() }
  })
})

describe('Playwright browser provider behavior', () => {
  it('does not forward ambient credentials or Harness settings into Chromium', async () => {
    vi.stubEnv('DSH_BROWSER_TEST_VALUE', 'not-forwarded')
    vi.stubEnv('BROWSER_TEST_TOKEN', 'not-forwarded')
    const launched = vi.spyOn(chromium, 'launchPersistentContext')
    const native = new PlaywrightBrowserProvider(resolvePlaywrightBrowserConfig({ storageDir: 'fixture' }))
    launched.mockRejectedValue(new Error('fixture launch declined'))
    try {
      await expect(native.listPages()).rejects.toThrow()
      const env = launched.mock.calls[0]?.[1]?.env
      expect(env).toBeDefined()
      expect(env).not.toHaveProperty('DSH_BROWSER_TEST_VALUE')
      expect(env).not.toHaveProperty('BROWSER_TEST_TOKEN')
      expect(Object.keys(env ?? {}).some(key => /KEY|PASSWORD|SECRET|TOKEN/i.test(key))).toBe(false)
    } finally {
      await native.dispose()
      launched.mockRestore()
      vi.unstubAllEnvs()
    }
  })
  it('owns persistent pages, observations, clicks, screenshots, and closure', async () => {
    const { context, launch, provider } = harness()
    const listed = await provider.listPages()
    expect(listed).toMatchObject([{ index: 0, url: 'about:blank', title: 'Fixture', active: true }])
    expect(launch).toHaveBeenCalledWith('C:/fixture/profile', expect.objectContaining({ channel: 'chrome', headless: true }))

    const opened = await provider.openPage({ url: 'https://example.com' })
    const observation = await provider.snapshot({ pageId: opened.pageId })
    expect(observation).toMatchObject({
      pageId: opened.pageId,
      url: 'https://example.com',
      elements: [{ elementId: 'e1', role: 'button', name: 'Continue' }],
    })
    expect(observation.tree).toContain('Interactive element references')

    await expect(provider.click({
      pageId: opened.pageId,
      observationId: observation.observationId,
      elementId: observation.elements[0]!.elementId,
    })).resolves.toMatchObject({ pageId: opened.pageId, elementId: 'e1' })
    await expect(provider.click({
      pageId: opened.pageId,
      observationId: observation.observationId,
      elementId: observation.elements[0]!.elementId,
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_OBSERVATION_STALE' }))

    await expect(provider.screenshot({ pageId: opened.pageId, format: 'png' })).resolves.toMatchObject({
      pageId: opened.pageId,
      mediaType: 'image/png',
      data: Uint8Array.of(1, 2, 3),
    })
    await expect(provider.navigate({ pageId: opened.pageId, url: 'https://example.com/next' })).resolves.toMatchObject({
      pageId: opened.pageId,
      url: 'https://example.com/next',
    })
    await expect(provider.closePage({ pageId: opened.pageId })).resolves.toBeUndefined()
    await expect(provider.closePage({ pageId: opened.pageId }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_PAGE_NOT_FOUND' }))
    await provider.dispose()
    expect(context.close).toHaveBeenCalledTimes(1)
    expect(provider.available()).toBe(false)
  })

  it('captures an observation-bound element with a bounded clip and two-pass verification', async () => {
    const { context, provider } = harness({ maxCaptureBytes: 10, maxCapturePixels: 2_000 })
    const [page] = await provider.listPages()
    if (page === undefined) throw new Error('missing fixture page')
    const observation = await provider.snapshot({ pageId: page.pageId })
    const capture = await provider.captureElement({
      pageId: page.pageId,
      target: { kind: 'observation', observationId: observation.observationId, elementId: observation.elements[0]!.elementId },
      format: 'png',
    })
    expect(capture).toMatchObject({
      pageId: page.pageId,
      verified: true,
      rect: { x: 10, y: 20, width: 30, height: 40 },
      viewport: { width: 800, height: 600 },
      data: Uint8Array.of(1, 2, 3),
    })
    expect(context.initial.screenshot).toHaveBeenCalledWith({ type: 'png', clip: { x: 10, y: 20, width: 30, height: 40 } })
    await provider.dispose()
  })

  it('rejects empty and over-budget element bounds before screenshot', async () => {
    const empty = harness()
    const [emptyPage] = await empty.provider.listPages()
    if (emptyPage === undefined) throw new Error('missing fixture page')
    const emptyObservation = await empty.provider.snapshot({ pageId: emptyPage.pageId })
    empty.context.initial.element.boxes = [{ x: 0, y: 0, width: 0, height: 10 }]
    await expect(empty.provider.captureElement({
      pageId: emptyPage.pageId,
      target: { kind: 'observation', observationId: emptyObservation.observationId, elementId: emptyObservation.elements[0]!.elementId },
      format: 'png',
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_ELEMENT_CAPTURE_BOUNDS' }))
    await empty.provider.dispose()

    const overBudget = harness({ maxCapturePixels: 10 })
    const [budgetPage] = await overBudget.provider.listPages()
    if (budgetPage === undefined) throw new Error('missing fixture page')
    const budgetObservation = await overBudget.provider.snapshot({ pageId: budgetPage.pageId })
    await expect(overBudget.provider.captureElement({
      pageId: budgetPage.pageId,
      target: { kind: 'observation', observationId: budgetObservation.observationId, elementId: budgetObservation.elements[0]!.elementId },
      format: 'png',
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_ELEMENT_CAPTURE_BOUNDS' }))
    await overBudget.provider.dispose()
  })

  it('selects an element, removes its marker, and consumes the selection after capture', async () => {
    const { context, provider } = harness()
    const [page] = await provider.listPages()
    if (page === undefined) throw new Error('missing fixture page')
    const selection = await provider.selectElement({ pageId: page.pageId })
    expect(selection).toMatchObject({
      pageId: page.pageId,
      tagName: 'button',
      role: 'button',
      name: 'Continue',
      text: 'Continue',
      rect: { x: 10, y: 20, width: 30, height: 40 },
    })
    expect(context.initial.overlayCleanupCalls).toBe(1)
    expect(context.initial.removedMarkerKeys).toHaveLength(1)

    await expect(provider.captureElement({
      pageId: page.pageId,
      target: { kind: 'selection', selectionId: selection.selectionId },
      format: 'jpeg',
    })).resolves.toMatchObject({
      pageId: page.pageId,
      target: { kind: 'selection', selectionId: selection.selectionId },
      mediaType: 'image/jpeg',
      verified: true,
    })
    expect(context.initial.element.dispose).toHaveBeenCalledOnce()
    await expect(provider.captureElement({
      pageId: page.pageId,
      target: { kind: 'selection', selectionId: selection.selectionId },
      format: 'png',
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_ELEMENT_STALE' }))
    await provider.dispose()
  })

  it('settles cancelled and timed-out selections after clearing the page overlay', async () => {
    const cancelled = harness()
    const [cancelledPage] = await cancelled.provider.listPages()
    if (cancelledPage === undefined) throw new Error('missing fixture page')
    cancelled.context.initial.beginPendingSelection()
    const controller = new AbortController()
    const pending = cancelled.provider.selectElement({ pageId: cancelledPage.pageId }, controller.signal)
    await vi.waitFor(() => { expect(cancelled.context.initial.evaluateNames).toContain('selectElementInPage') })
    controller.abort(new Error('selection stopped'))
    await expect(pending).rejects.toThrow('selection stopped')
    expect(cancelled.context.initial.overlayCleanupCalls).toBe(1)
    await cancelled.provider.dispose()

    const timedOut = harness({ selectionTimeoutMs: 1 })
    const [timedOutPage] = await timedOut.provider.listPages()
    if (timedOutPage === undefined) throw new Error('missing fixture page')
    timedOut.context.initial.beginPendingSelection()
    await expect(timedOut.provider.selectElement({ pageId: timedOutPage.pageId }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_SELECTION_TIMEOUT' }))
    expect(timedOut.context.initial.overlayCleanupCalls).toBe(1)
    await timedOut.provider.dispose()
  })

  it('lets a newer selection replace an older overlay without the older cleanup cancelling it', async () => {
    const { context, provider } = harness()
    const [page] = await provider.listPages()
    if (page === undefined) throw new Error('missing fixture page')
    context.initial.beginPendingSelection()
    const first = provider.selectElement({ pageId: page.pageId })
    await vi.waitFor(() => {
      expect(context.initial.evaluateNames.filter(name => name === 'selectElementInPage')).toHaveLength(1)
    })
    const secondController = new AbortController()
    const second = provider.selectElement({ pageId: page.pageId }, secondController.signal)
    await expect(first).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_SELECTION_CANCELLED' }))

    let secondSettled = false
    void second.then(() => { secondSettled = true }, () => { secondSettled = true })
    await Promise.resolve()
    expect(secondSettled).toBe(false)
    secondController.abort(new Error('second stopped'))
    await expect(second).rejects.toThrow('second stopped')
    await provider.dispose()
  })
  it('classifies page-level selection cancellation and cleans failed marker recovery', async () => {
    const cancelled = harness()
    const [cancelledPage] = await cancelled.provider.listPages()
    if (cancelledPage === undefined) throw new Error('missing fixture page')
    cancelled.context.initial.overlaySelection = null
    await expect(cancelled.provider.selectElement({ pageId: cancelledPage.pageId }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_SELECTION_CANCELLED' }))
    await cancelled.provider.dispose()

    const missing = harness()
    const [missingPage] = await missing.provider.listPages()
    if (missingPage === undefined) throw new Error('missing fixture page')
    missing.context.initial.selectionItems = []
    await expect(missing.provider.selectElement({ pageId: missingPage.pageId }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_ELEMENT_STALE' }))
    expect(missing.context.initial.removedMarkerKeys).toHaveLength(1)
    missing.context.initial.removeMarkerFailure = new Error('page navigated during cleanup')
    await expect(missing.provider.selectElement({ pageId: missingPage.pageId }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_ELEMENT_STALE' }))
    await missing.provider.dispose()

    const failedFingerprint = harness()
    const [failedPage] = await failedFingerprint.provider.listPages()
    if (failedPage === undefined) throw new Error('missing fixture page')
    failedFingerprint.context.initial.element.evaluateFailure = new Error('fingerprint failed')
    await expect(failedFingerprint.provider.selectElement({ pageId: failedPage.pageId }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_ELEMENT_CAPTURE_FAILED' }))
    expect(failedFingerprint.context.initial.element.dispose).toHaveBeenCalledOnce()
    await failedFingerprint.provider.dispose()
  })

  it('rejects changed, unbounded, oversized, and failed element captures', async () => {
    const changed = harness()
    const [changedPage] = await changed.provider.listPages()
    if (changedPage === undefined) throw new Error('missing fixture page')
    const changedObservation = await changed.provider.snapshot({ pageId: changedPage.pageId })
    changed.context.initial.element.fingerprints = [
      { tagName: 'button', role: 'button', name: 'Continue', text: 'Continue' },
      { tagName: 'button', role: 'button', name: 'Changed', text: 'Changed' },
    ]
    await expect(changed.provider.captureElement({
      pageId: changedPage.pageId,
      target: { kind: 'observation', observationId: changedObservation.observationId, elementId: changedObservation.elements[0]!.elementId },
      format: 'png',
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_ELEMENT_CHANGED' }))
    await changed.provider.dispose()

    const invisible = harness()
    const [invisiblePage] = await invisible.provider.listPages()
    if (invisiblePage === undefined) throw new Error('missing fixture page')
    const invisibleObservation = await invisible.provider.snapshot({ pageId: invisiblePage.pageId })
    invisible.context.initial.element.boxes = [null]
    await expect(invisible.provider.captureElement({
      pageId: invisiblePage.pageId,
      target: { kind: 'observation', observationId: invisibleObservation.observationId, elementId: invisibleObservation.elements[0]!.elementId },
      format: 'png',
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_ELEMENT_CAPTURE_BOUNDS' }))
    await invisible.provider.dispose()

    const oversized = harness({ maxCaptureBytes: 2 })
    const [oversizedPage] = await oversized.provider.listPages()
    if (oversizedPage === undefined) throw new Error('missing fixture page')
    const oversizedObservation = await oversized.provider.snapshot({ pageId: oversizedPage.pageId })
    await expect(oversized.provider.captureElement({
      pageId: oversizedPage.pageId,
      target: { kind: 'observation', observationId: oversizedObservation.observationId, elementId: oversizedObservation.elements[0]!.elementId },
      format: 'png',
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_ELEMENT_CAPTURE_TOO_LARGE' }))
    await oversized.provider.dispose()

    const failed = harness()
    const [failedPage] = await failed.provider.listPages()
    if (failedPage === undefined) throw new Error('missing fixture page')
    const failedObservation = await failed.provider.snapshot({ pageId: failedPage.pageId })
    failed.context.initial.screenshotFailure = new Error('crop failed')
    await expect(failed.provider.captureElement({
      pageId: failedPage.pageId,
      target: { kind: 'observation', observationId: failedObservation.observationId, elementId: failedObservation.elements[0]!.elementId },
      format: 'png',
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_ELEMENT_CAPTURE_FAILED' }))
    await failed.provider.dispose()
  })

  it('runs the injected overlay scripts against a real in-page DOM', async () => {
    const { context, provider } = harness()
    const dom = new FakeDom()
    context.initial.dom = dom
    const [page] = await provider.listPages()
    if (page === undefined) throw new Error('missing fixture page')
    dom.install()
    try {
      const target = dom.create('button', '  Continue  ')
      target.rect = { x: 10, y: 20, width: 30, height: 40 }
      target.setAttribute('title', 'Continue')
      const zeroSize = dom.create('span', 'hidden')
      const decoy = dom.create('i', 'decoy')
      decoy.setAttribute('data-dsh-browser-element', 'other')

      const pending = provider.selectElement({ pageId: page.pageId })
      const overlay = dom.overlay()
      expect(dom.captureKey()).toBeDefined()
      dom.dispatch('pointermove', new FakeDomEvent('not-an-element'))
      dom.dispatch('keydown', new FakeDomEvent(target, 'Tab'))
      dom.dispatch('pointermove', new FakeDomEvent(zeroSize))
      expect(overlay?.style.display).toBe('none')
      dom.dispatch('pointermove', new FakeDomEvent(target))
      expect(overlay?.style).toMatchObject({ display: 'block', left: '10px', top: '20px', width: '30px', height: '40px' })
      dom.dispatch('click', new FakeDomEvent('not-an-element'))
      dom.dispatch('click', new FakeDomEvent(target))

      const selection = await pending
      // Identity comes from the element handle the page marker resolves to; the
      // overlay contributes the marker key and the selected node's bounds.
      expect(selection).toMatchObject({
        pageId: page.pageId,
        tagName: 'button',
        role: 'button',
        name: 'Continue',
        text: 'Continue',
        rect: { x: 10, y: 20, width: 30, height: 40 },
      })
      expect(overlay?.removed).toBe(true)
      expect(dom.captureKey()).toBeUndefined()
      expect(dom.listeners.get('click')).toEqual([])
      expect(target.getAttribute('data-dsh-browser-element')).toBeNull()
      expect(decoy.getAttribute('data-dsh-browser-element')).toBe('other')
      await expect(provider.captureElement({
        pageId: page.pageId,
        target: { kind: 'selection', selectionId: selection.selectionId },
        format: 'png',
      })).resolves.toMatchObject({ verified: true, tagName: 'button', rect: { x: 10, y: 20, width: 30, height: 40 } })
    } finally {
      dom.restore()
      await provider.dispose()
    }
  })

  it('cancels overlay selection for empty bounds, Escape, and a replaced overlay', async () => {
    const { context, provider } = harness()
    const dom = new FakeDom()
    context.initial.dom = dom
    const [page] = await provider.listPages()
    if (page === undefined) throw new Error('missing fixture page')
    dom.install()
    try {
      const zeroSize = dom.create('div', '')
      const typed = dom.create('input', '  Search  ')
      typed.rect = { x: 5, y: 6, width: 7, height: 8 }

      const emptyBounds = provider.selectElement({ pageId: page.pageId })
      dom.dispatch('pointermove', new FakeDomEvent(zeroSize))
      dom.dispatch('click', new FakeDomEvent(zeroSize))
      await expect(emptyBounds).rejects.toMatchObject({ code: 'BROWSER_SELECTION_CANCELLED' })

      const directTarget = provider.selectElement({ pageId: page.pageId })
      dom.dispatch('click', new FakeDomEvent(typed))
      await expect(directTarget).resolves.toMatchObject({ rect: { x: 5, y: 6, width: 7, height: 8 } })

      const escaped = provider.selectElement({ pageId: page.pageId })
      dom.dispatch('keydown', new FakeDomEvent(typed, 'Escape'))
      await expect(escaped).rejects.toMatchObject({ code: 'BROWSER_SELECTION_CANCELLED' })

      const replaced = provider.selectElement({ pageId: page.pageId })
      const replacing = provider.selectElement({ pageId: page.pageId })
      await expect(replaced).rejects.toMatchObject({ code: 'BROWSER_SELECTION_CANCELLED' })
      await expect(replacing).rejects.toMatchObject({ code: 'BROWSER_SELECTION_CANCELLED' })
      expect(dom.captureKey()).toBeUndefined()
    } finally {
      dom.restore()
      await provider.dispose()
    }
  })

  it('clears a pending page overlay through the cleanup hook on cancellation and timeout', async () => {
    const cancelled = harness()
    const dom = new FakeDom()
    cancelled.context.initial.dom = dom
    const [page] = await cancelled.provider.listPages()
    if (page === undefined) throw new Error('missing fixture page')
    dom.install()
    try {
      const controller = new AbortController()
      const pending = cancelled.provider.selectElement({ pageId: page.pageId }, controller.signal)
      const capture = dom.window.__dshBrowserElementCapture
      expect(capture?.key).toBeDefined()
      controller.abort(new Error('selection stopped'))
      await expect(pending).rejects.toThrow('selection stopped')
      expect(dom.overlay()?.removed).toBe(true)
      expect(dom.captureKey()).toBeUndefined()
      capture?.cleanup()
      expect(dom.overlay()?.removed).toBe(true)
    } finally {
      dom.restore()
      await cancelled.provider.dispose()
    }

    const timedOut = harness({ selectionTimeoutMs: 1 })
    const timeoutDom = new FakeDom()
    timedOut.context.initial.dom = timeoutDom
    const [timeoutPage] = await timedOut.provider.listPages()
    if (timeoutPage === undefined) throw new Error('missing fixture page')
    timeoutDom.install()
    try {
      await expect(timedOut.provider.selectElement({ pageId: timeoutPage.pageId }))
        .rejects.toMatchObject({ code: 'BROWSER_SELECTION_TIMEOUT' })
      expect(timeoutDom.overlay()?.removed).toBe(true)
    } finally {
      timeoutDom.restore()
      await timedOut.provider.dispose()
    }
  })

  it('uses an executable without a channel and supports the default Playwright launcher', async () => {
    const context = new FakeContext()
    const launch = vi.spyOn(chromium, 'launchPersistentContext')
      .mockResolvedValue(context as unknown as BrowserContext)
    try {
      const config = resolvePlaywrightBrowserConfig({
        storageDir: 'C:/fixture/profile',
        executablePath: 'C:/Browser/browser.exe',
      })
      const provider = new PlaywrightBrowserProvider(config)
      await expect(provider.listPages()).resolves.toHaveLength(1)
      expect(launch).toHaveBeenCalledWith('C:/fixture/profile', expect.objectContaining({
        executablePath: 'C:/Browser/browser.exe',
      }))
      expect(launch.mock.calls[0]?.[1]).not.toHaveProperty('channel')
      await provider.dispose()
    } finally {
      launch.mockRestore()
    }
  })

  it('binds caller cancellation and closes a context that finishes launching during disposal', async () => {
    const config = resolvePlaywrightBrowserConfig({ storageDir: 'C:/fixture/profile' })
    const context = new FakeContext()
    let resolveLaunch!: (context: BrowserContext) => void
    const launched = new Promise<BrowserContext>((resolve) => { resolveLaunch = resolve })
    const provider = new PlaywrightBrowserProvider(config, () => launched)
    const controller = new AbortController()
    const pending = provider.listPages(controller.signal)
    controller.abort(new Error('caller stopped'))
    await expect(pending).rejects.toThrow('caller stopped')

    const disposing = provider.dispose()
    resolveLaunch(context as unknown as BrowserContext)
    await disposing
    expect(context.close).toHaveBeenCalledTimes(1)
  })

  it('rejects an already-aborted caller signal without waiting for launch', async () => {
    const { context, provider } = harness()
    const controller = new AbortController()
    controller.abort(new Error('already stopped'))
    await expect(provider.listPages(controller.signal)).rejects.toThrow('already stopped')
    await provider.dispose()
    expect(context.close).toHaveBeenCalledTimes(1)
  })

  it('keeps observations across child-frame navigation and invalidates them on main-frame navigation', async () => {
    const { context, provider } = harness()
    const [listed] = await provider.listPages()
    if (listed === undefined) throw new Error('missing fixture page')
    const first = await provider.snapshot({ pageId: listed.pageId })
    context.initial.emit('framenavigated', {})
    await expect(provider.click({
      pageId: listed.pageId,
      observationId: first.observationId,
      elementId: first.elements[0]!.elementId,
    })).resolves.toMatchObject({ elementId: 'e1' })

    const second = await provider.snapshot({ pageId: listed.pageId })
    context.initial.emit('framenavigated', context.initial.frame)
    await vi.waitFor(() => { expect(context.initial.element.dispose).toHaveBeenCalledTimes(2) })
    await expect(provider.click({
      pageId: listed.pageId,
      observationId: second.observationId,
      elementId: second.elements[0]!.elementId,
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_OBSERVATION_STALE' }))
    await provider.listPages()
    await provider.dispose()
  })

  it('filters unusable elements and derives role and name fallbacks', async () => {
    const { context, provider } = harness({ maxElements: 7 })
    const titleElement = new FakeElement()
    const textElement = new FakeElement()
    const emptyElement = new FakeElement()
    context.initial.items = [
      new FakeItem(new FakeElement(), { tag: 'button', visible: false }),
      new FakeItem(new FakeElement(), { tag: 'button', visible: 'reject' }),
      new FakeItem(new FakeElement(), { tag: 'button', handle: false }),
      new FakeItem(titleElement, { tag: 'a', title: 'Details' }),
      new FakeItem(textElement, { tag: 'input', text: '  Search  ' }),
      new FakeItem(emptyElement, { tag: 'select', text: null }),
      new FakeItem(new FakeElement(), { tag: 'summary', label: 'Beyond limit' }),
    ]
    const [page] = await provider.listPages()
    if (page === undefined) throw new Error('missing fixture page')
    const observation = await provider.snapshot({ pageId: page.pageId })
    expect(observation.elements).toEqual([
      { elementId: 'e1', role: 'a', name: 'Details' },
      { elementId: 'e2', role: 'input', name: 'Search' },
      { elementId: 'e3', role: 'select', name: '' },
      { elementId: 'e4', role: 'summary', name: 'Beyond limit' },
    ])
    expect(observation.tree).toContain('a "Details" [ref=e1]')
    await provider.dispose()
    expect(titleElement.dispose).toHaveBeenCalledOnce()
    expect(textElement.dispose).toHaveBeenCalledOnce()
    expect(emptyElement.dispose).toHaveBeenCalledOnce()
  })

  it('returns the unmodified accessibility tree when no element is usable', async () => {
    const { context, provider } = harness()
    context.initial.items = []
    const [page] = await provider.listPages()
    if (page === undefined) throw new Error('missing fixture page')
    await expect(provider.snapshot({ pageId: page.pageId })).resolves.toMatchObject({
      tree: '- document "Fixture"',
      elements: [],
    })
    await provider.dispose()
  })

  it('reports lifecycle state and closes the owned context on demand', async () => {
    const idle = new PlaywrightBrowserProvider(
      resolvePlaywrightBrowserConfig({ storageDir: 'C:/fixture/profile' }),
      () => Promise.reject(new Error('must not launch')),
    )
    expect(idle.browserState()).toBe('stopped')
    expect(idle.cdpEndpoint()).toBeUndefined()
    await expect(idle.closeBrowser()).resolves.toBeUndefined()
    await idle.dispose()

    const { context, provider } = harness()
    expect(provider.browserState()).toBe('stopped')
    const launching = provider.listPages()
    expect(provider.browserState()).toBe('starting')
    await launching
    expect(provider.browserState()).toBe('running')
    await provider.closeBrowser()
    expect(context.close).toHaveBeenCalledOnce()
    expect(provider.browserState()).toBe('stopped')
    await provider.dispose()
  })

  it('resolves home, url, and search navigation and rejects unknown targets', () => {
    const { provider } = harness({ homePage: 'https://example.test/home', searchEngine: 'duckduckgo' })
    expect(provider.resolveNavigation({ kind: 'url', url: 'https://example.test/page' })).toEqual({ url: 'https://example.test/page' })
    expect(provider.resolveNavigation({ kind: 'search', query: 'fixture' })).toEqual({ url: 'https://duckduckgo.com/?q=fixture' })
    expect(() => provider.resolveNavigation({ kind: 'url', url: 'file:///etc/passwd' })).toThrow(/must be an HTTP or HTTPS URL/)
    expect(() => provider.resolveNavigation({ kind: 'unknown' } as never)).toThrow(/unreachable variant/)
  })

  it('drops retained selections when the page is invalidated', async () => {
    const { context, provider } = harness()
    const [page] = await provider.listPages()
    if (page === undefined) throw new Error('missing fixture page')
    const selection = await provider.selectElement({ pageId: page.pageId })
    context.initial.element.dispose.mockClear()
    await provider.navigate({ pageId: page.pageId, url: 'https://example.test/next' })
    expect(context.initial.element.dispose).toHaveBeenCalledOnce()
    await expect(provider.captureElement({
      pageId: page.pageId,
      target: { kind: 'selection', selectionId: selection.selectionId },
      format: 'png',
    })).rejects.toMatchObject({ code: 'BROWSER_ELEMENT_STALE' })
    await provider.dispose()
  })

  it('classifies overlay injection, marker recovery, and viewport failures', async () => {
    const injection = harness()
    const [injectionPage] = await injection.provider.listPages()
    if (injectionPage === undefined) throw new Error('missing fixture page')
    injection.context.initial.overlayFailure = new Error('overlay injection failed')
    injection.context.initial.clearOverlayFailure = new Error('page navigated before cleanup')
    await expect(injection.provider.selectElement({ pageId: injectionPage.pageId }))
      .rejects.toMatchObject({ code: 'BROWSER_ELEMENT_CAPTURE_FAILED' })
    expect(injection.context.initial.overlayCleanupCalls).toBe(1)
    await injection.provider.dispose()

    const missingHandle = harness()
    const [missingHandlePage] = await missingHandle.provider.listPages()
    if (missingHandlePage === undefined) throw new Error('missing fixture page')
    missingHandle.context.initial.selectionItems = [new FakeItem(new FakeElement(), { tag: 'button', handle: false })]
    await expect(missingHandle.provider.selectElement({ pageId: missingHandlePage.pageId }))
      .rejects.toMatchObject({ code: 'BROWSER_ELEMENT_STALE' })
    await missingHandle.provider.dispose()

    const viewport = harness()
    const [viewportPage] = await viewport.provider.listPages()
    if (viewportPage === undefined) throw new Error('missing fixture page')
    const observation = await viewport.provider.snapshot({ pageId: viewportPage.pageId })
    viewport.context.initial.viewportFailure = new Error('viewport probe failed')
    await expect(viewport.provider.captureElement({
      pageId: viewportPage.pageId,
      target: { kind: 'observation', observationId: observation.observationId, elementId: observation.elements[0]!.elementId },
      format: 'png',
    })).rejects.toMatchObject({ code: 'BROWSER_ELEMENT_CAPTURE_FAILED' })
    await viewport.provider.dispose()
  })

  it('rejects with the caller failure when cancellation lands after the overlay settled', async () => {
    const { context, provider } = harness()
    const [page] = await provider.listPages()
    if (page === undefined) throw new Error('missing fixture page')
    context.initial.beginPendingSelection()
    const controller = new AbortController()
    const pending = provider.selectElement({ pageId: page.pageId }, controller.signal)
    await vi.waitFor(() => { expect(context.initial.evaluateNames).toContain('selectElementInPage') })
    context.initial.completeSelection()
    controller.abort(new Error('selection stopped late'))
    await expect(pending).rejects.toThrow('selection stopped late')
    await provider.dispose()
  })

  it('keeps a provider-held browser error instead of reclassifying it', async () => {
    const { context, provider } = harness()
    const [page] = await provider.listPages()
    if (page === undefined) throw new Error('missing fixture page')
    context.initial.ariaFailure = new BrowserError('browser page was closed', 'BROWSER_PAGE_CLOSED')
    await expect(provider.snapshot({ pageId: page.pageId })).rejects.toMatchObject({ code: 'BROWSER_PAGE_CLOSED' })
    context.initial.ariaFailure = undefined
    const observation = await provider.snapshot({ pageId: page.pageId })
    context.initial.element.clickFailure = new BrowserError('browser page was closed', 'BROWSER_PAGE_CLOSED')
    await expect(provider.click({
      pageId: page.pageId,
      observationId: observation.observationId,
      elementId: observation.elements[0]!.elementId,
    })).rejects.toMatchObject({ code: 'BROWSER_PAGE_CLOSED' })
    await provider.dispose()
  })

  it('rejects stale, absent, changed, and hidden element capture targets', async () => {
    const stale = harness()
    const [stalePage] = await stale.provider.listPages()
    if (stalePage === undefined) throw new Error('missing fixture page')
    await expect(stale.provider.captureElement({
      pageId: stalePage.pageId,
      target: { kind: 'observation', observationId: BrowserObservationId('missing'), elementId: BrowserElementId('e1') },
      format: 'png',
    })).rejects.toMatchObject({ code: 'BROWSER_OBSERVATION_STALE' })
    const staleObservation = await stale.provider.snapshot({ pageId: stalePage.pageId })
    await expect(stale.provider.captureElement({
      pageId: stalePage.pageId,
      target: { kind: 'observation', observationId: staleObservation.observationId, elementId: BrowserElementId('e9') },
      format: 'png',
    })).rejects.toMatchObject({ code: 'BROWSER_ELEMENT_STALE' })
    await stale.provider.dispose()

    const changed = harness()
    const [changedPage] = await changed.provider.listPages()
    if (changedPage === undefined) throw new Error('missing fixture page')
    const selection = await changed.provider.selectElement({ pageId: changedPage.pageId })
    changed.context.initial.element.fingerprints = [{ tagName: 'button', role: 'button', name: 'Changed', text: 'Changed' }]
    await expect(changed.provider.captureElement({
      pageId: changedPage.pageId,
      target: { kind: 'selection', selectionId: selection.selectionId },
      format: 'png',
    })).rejects.toMatchObject({ code: 'BROWSER_ELEMENT_CHANGED', message: expect.stringContaining('changed after selection') })
    await changed.provider.dispose()

    const hidden = harness()
    const [hiddenPage] = await hidden.provider.listPages()
    if (hiddenPage === undefined) throw new Error('missing fixture page')
    const hiddenObservation = await hidden.provider.snapshot({ pageId: hiddenPage.pageId })
    hidden.context.initial.element.boxes = [{ x: 10, y: 20, width: 30, height: 40 }, null]
    await expect(hidden.provider.captureElement({
      pageId: hiddenPage.pageId,
      target: { kind: 'observation', observationId: hiddenObservation.observationId, elementId: hiddenObservation.elements[0]!.elementId },
      format: 'png',
    })).rejects.toMatchObject({ code: 'BROWSER_ELEMENT_CHANGED', message: expect.stringContaining('became invisible') })
    await hidden.provider.dispose()

    const closed = harness()
    const [closedPage] = await closed.provider.listPages()
    if (closedPage === undefined) throw new Error('missing fixture page')
    const closedObservation = await closed.provider.snapshot({ pageId: closedPage.pageId })
    let release!: (value: Buffer) => void
    closed.context.initial.screenshotPending = new Promise((resolve) => { release = resolve })
    const pending = closed.provider.captureElement({
      pageId: closedPage.pageId,
      target: { kind: 'observation', observationId: closedObservation.observationId, elementId: closedObservation.elements[0]!.elementId },
      format: 'png',
    })
    await vi.waitFor(() => { expect(closed.context.initial.screenshot).toHaveBeenCalledOnce() })
    await closed.context.initial.close()
    await expect(pending).rejects.toMatchObject({ code: 'BROWSER_PAGE_CLOSED' })
    release(Buffer.from([1, 2, 3]))
    await closed.provider.dispose()
  })

  it('derives role and name fallbacks from the selected element handle', async () => {
    const { context, provider } = harness()
    const [page] = await provider.listPages()
    if (page === undefined) throw new Error('missing fixture page')
    context.initial.element.fingerprints = [
      { tagName: 'a', role: '', name: '', ariaLabel: null, title: null, text: 'Details' },
      { tagName: 'a', role: 'a', name: '', ariaLabel: null, title: 'Details', text: 'Details' },
      { tagName: 'a', role: 'a', name: 'Details', ariaLabel: 'Details', text: 'Details' },
    ]
    const selection = await provider.selectElement({ pageId: page.pageId })
    expect(selection).toMatchObject({ tagName: 'a', role: 'a', name: 'Details', text: 'Details' })
    await expect(provider.captureElement({
      pageId: page.pageId,
      target: { kind: 'selection', selectionId: selection.selectionId },
      format: 'png',
    })).resolves.toMatchObject({ verified: true, tagName: 'a', role: 'a', name: 'Details' })
    await provider.dispose()
  })

  it('maps a detached element and a non-Error page failure onto capture failures', async () => {
    const detached = harness()
    const [detachedPage] = await detached.provider.listPages()
    if (detachedPage === undefined) throw new Error('missing fixture page')
    const detachedObservation = await detached.provider.snapshot({ pageId: detachedPage.pageId })
    detached.context.initial.element.evaluateFailure = 'element is detached from the document'
    await expect(detached.provider.captureElement({
      pageId: detachedPage.pageId,
      target: { kind: 'observation', observationId: detachedObservation.observationId, elementId: detachedObservation.elements[0]!.elementId },
      format: 'png',
    })).rejects.toMatchObject({ code: 'BROWSER_ELEMENT_STALE', message: expect.stringContaining('take a new snapshot') })
    await detached.provider.dispose()

  })

  it('maps each Playwright operation failure and cleans partial page creation', async () => {
    const openCreation = harness()
    openCreation.context.newPage.mockRejectedValueOnce(new Error('new page failed'))
    await expect(openCreation.provider.openPage({ url: 'https://create.test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_NAVIGATION_FAILED' }))
    await openCreation.provider.dispose()

    const openNavigation = harness()
    const created = new FakePage()
    created.gotoFailure = new Error('goto failed')
    openNavigation.context.newPage.mockResolvedValueOnce(created as unknown as Page)
    await expect(openNavigation.provider.openPage({ url: 'https://open.test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_NAVIGATION_FAILED' }))
    await vi.waitFor(() => { expect(created.close).toHaveBeenCalledOnce() })
    await openNavigation.provider.dispose()

    const operations = harness()
    const [page] = await operations.provider.listPages()
    if (page === undefined) throw new Error('missing fixture page')
    operations.context.initial.gotoFailure = new Error('navigate failed')
    await expect(operations.provider.navigate({ pageId: page.pageId, url: 'https://navigate.test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_NAVIGATION_FAILED' }))
    operations.context.initial.gotoFailure = undefined
    operations.context.initial.ariaFailure = new Error('aria failed')
    await expect(operations.provider.snapshot({ pageId: page.pageId }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_SNAPSHOT_FAILED' }))
    operations.context.initial.ariaFailure = undefined
    const observation = await operations.provider.snapshot({ pageId: page.pageId })
    operations.context.initial.element.clickFailure = new Error('click failed')
    await expect(operations.provider.click({
      pageId: page.pageId,
      observationId: observation.observationId,
      elementId: observation.elements[0]!.elementId,
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_CLICK_FAILED' }))
    operations.context.initial.screenshotFailure = new Error('screenshot failed')
    await expect(operations.provider.screenshot({ pageId: page.pageId, format: 'png' }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_SCREENSHOT_FAILED' }))
    operations.context.initial.screenshotFailure = undefined
    await expect(operations.provider.screenshot({ pageId: page.pageId, format: 'jpeg' })).resolves.toMatchObject({
      mediaType: 'image/jpeg',
    })
    operations.context.initial.closeFailure = new Error('close failed')
    await expect(operations.provider.closePage({ pageId: page.pageId }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_CLOSE_FAILED' }))
    operations.context.initial.closeFailure = undefined
    await operations.provider.dispose()
  })

  it.each([
    [Object.assign(new Error('Element is not attached to the DOM'), { name: 'Error' }), 'BROWSER_ELEMENT_STALE', 'detached'],
    [Object.assign(new Error('Timeout 30000ms exceeded'), { name: 'TimeoutError' }), 'BROWSER_CLICK_TIMEOUT', 'timeout'],
    [new Error('another element intercepts pointer events'), 'BROWSER_CLICK_NOT_ACTIONABLE', 'not actionable'],
    [new Error('selected click failure'), 'BROWSER_CLICK_FAILED', "Could not click element 'e1'"],
    ['click exploded', 'BROWSER_CLICK_FAILED', "Could not click element 'e1'"],
  ])('classifies click failure %s as %s', async (failure, code, message) => {
    const { context, provider } = harness()
    const [page] = await provider.listPages()
    if (page === undefined) throw new Error('missing fixture page')
    const observation = await provider.snapshot({ pageId: page.pageId })
    context.initial.element.clickFailure = failure
    await expect(provider.click({
      pageId: page.pageId,
      observationId: observation.observationId,
      elementId: observation.elements[0]!.elementId,
    })).rejects.toThrow(expect.objectContaining({ code, message: expect.stringContaining(message) }))
    await provider.dispose()
  })

  it('preserves abort reasons during open and navigate', async () => {
    const open = harness()
    const openController = new AbortController()
    const openPage = new FakePage()
    let resolveOpen!: () => void
    openPage.goto.mockImplementationOnce(() => new Promise((resolve) => { resolveOpen = () => { resolve(null) } }))
    open.context.newPage.mockResolvedValueOnce(openPage as unknown as Page)
    const pendingOpen = open.provider.openPage({ url: 'https://open.test' }, openController.signal)
    await vi.waitFor(() => { expect(openPage.goto).toHaveBeenCalledOnce() })
    openController.abort(new Error('open stopped'))
    await expect(pendingOpen).rejects.toThrow('open stopped')
    resolveOpen()
    await open.provider.dispose()

    const navigate = harness()
    const [page] = await navigate.provider.listPages()
    if (page === undefined) throw new Error('missing fixture page')
    const navigateController = new AbortController()
    let resolveNavigate!: () => void
    navigate.context.initial.goto.mockImplementationOnce(() => new Promise((resolve) => {
      resolveNavigate = () => { resolve(null) }
    }))
    const pendingNavigate = navigate.provider.navigate({ pageId: page.pageId, url: 'https://navigate.test' }, navigateController.signal)
    await vi.waitFor(() => { expect(navigate.context.initial.goto).toHaveBeenCalledOnce() })
    navigateController.abort(new Error('navigate stopped'))
    await expect(pendingNavigate).rejects.toThrow('navigate stopped')
    resolveNavigate()
    await navigate.provider.dispose()
  })

  it('aborts an in-flight page operation when the page is closed externally', async () => {
    const { context, provider } = harness()
    const [page] = await provider.listPages()
    if (page === undefined) throw new Error('missing fixture page')
    let release!: (value: Buffer) => void
    context.initial.screenshotPending = new Promise((resolve) => { release = resolve })
    const pending = provider.screenshot({ pageId: page.pageId, format: 'png' })
    await vi.waitFor(() => { expect(context.initial.screenshot).toHaveBeenCalledOnce() })
    await context.initial.close()
    await expect(pending).rejects.toThrow(expect.objectContaining({
      code: 'BROWSER_PAGE_CLOSED',
      message: expect.stringContaining('was closed'),
    }))
    release(Buffer.from([1, 2, 3]))
    await provider.dispose()
  })

  it('rejects stale observation and element identities without Playwright I/O', async () => {
    const { provider } = harness()
    const [page] = await provider.listPages()
    if (page === undefined) throw new Error('missing fixture page')
    await expect(provider.click({
      pageId: page.pageId,
      observationId: BrowserObservationId('missing'),
      elementId: BrowserElementId('e1'),
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_OBSERVATION_STALE' }))
    const observation = await provider.snapshot({ pageId: page.pageId })
    await expect(provider.click({
      pageId: page.pageId,
      observationId: observation.observationId,
      elementId: BrowserElementId('missing'),
    })).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_ELEMENT_STALE' }))
    await expect(provider.snapshot({ pageId: BrowserPageId('missing') }))
      .rejects.toThrow(expect.objectContaining({ code: 'BROWSER_PAGE_NOT_FOUND' }))
    await provider.dispose()
  })

  it('maps launch failures and supports idempotent disposal before launch', async () => {
    const config = resolvePlaywrightBrowserConfig({ storageDir: 'C:/fixture/profile' })
    const failed = new PlaywrightBrowserProvider(config, () => Promise.reject(new Error('missing chrome')))
    await expect(failed.listPages()).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_PLAYWRIGHT_LAUNCH_FAILED' }))
    await failed.dispose()
    await failed.dispose()

    const idle = new PlaywrightBrowserProvider(config, () => Promise.reject(new Error('must not launch')))
    await idle.dispose()
    await expect(idle.listPages()).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_PROVIDER_DISPOSED' }))
  })

  it('finishes disposal when an in-flight browser launch fails', async () => {
    const config = resolvePlaywrightBrowserConfig({ storageDir: 'C:/fixture/profile' })
    let rejectLaunch!: (error: Error) => void
    const launched = new Promise<BrowserContext>((_resolve, reject) => { rejectLaunch = reject })
    const provider = new PlaywrightBrowserProvider(config, () => launched)
    const operation = provider.listPages()
    const disposing = provider.dispose()
    rejectLaunch(new Error('launch stopped'))
    await expect(operation).rejects.toThrow(expect.objectContaining({ code: 'BROWSER_PROVIDER_DISPOSED' }))
    await expect(disposing).resolves.toBeUndefined()
  })
})

function createMockSettings(initial: Record<string, unknown> = {}, onWrite?: (val: Record<string, unknown>) => Promise<void> | void) {
  let registered = true
  let stored = { ...initial }
  return (c: Context) => {
    c.provide('settings', {
      describe: () => !registered ? [] : [{ ns: 'browser-playwright', applies: 'restart', value: stored }],
      update: async (_ns: string, patch: Record<string, unknown>) => {
        if (patch.viewportWidth === 0 || patch.storageDir === 'outside-profile') {
          throw new Error('invalid')
        }
        stored = { ...stored, ...patch }
        await onWrite?.(stored)
      },
      configure: () => { registered = true; return () => { registered = false } },
    } as never)
  }
}

describe('Playwright browser Cordis plugins', () => {
  it('attaches to an existing browser and disconnects without closing it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-browser-attach-'))
    const ctx = new Context()
    const context = new FakeContext()
    const detach = vi.fn(async () => {})
    const connect = vi.spyOn(chromium, 'connectOverCDP').mockResolvedValue({
      contexts: () => [context], close: detach,
    } as unknown as Browser)
    try {
      await ctx.plugin(createMockSettings({ browserChannel: 'chrome', attach: true, attachPort: 9333 }))
      await ctx.plugin(BrowserRuntime)
      ctx.provide('subprocess', { spawn: vi.fn(() => { throw new Error('Unexpected installer') }) } as never)
      await ctx.plugin(BrowserRuntimeManager, { storageDir: join(root, 'runtime') })
      const fiber = await ctx.plugin(PlaywrightBrowser, { storageDir: join(root, 'profile') })
      expect((await ctx.browser.listPages()).length).toBe(1)
      expect(connect).toHaveBeenCalledWith('http://127.0.0.1:9333')
      expect(context.close).not.toHaveBeenCalled()
      await fiber.dispose()
      expect(detach).toHaveBeenCalled()
      expect(context.close).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
      connect.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('mounts the Browser provider when no settings provider exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-browser-no-settings-'))
    const ctx = new Context()
    try {
      await ctx.plugin(BrowserRuntime)
      ctx.provide('subprocess', { spawn: vi.fn(() => { throw new Error('Unexpected installer') }) } as never)
      await ctx.plugin(BrowserRuntimeManager, { storageDir: join(root, 'runtime') })
      const fiber = await ctx.plugin(PlaywrightBrowser)
      expect(ctx.get('settings')).toBeUndefined()
      await fiber.dispose()
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('registers and removes the Browser provider without launching it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-browser-preferences-'))
    const ctx = new Context()
    try {
      await ctx.plugin(createMockSettings())
      await ctx.plugin(BrowserRuntime)
      ctx.provide('subprocess', { spawn: vi.fn(() => { throw new Error('Unexpected installer') }) } as never)
      await ctx.plugin(BrowserRuntimeManager, { storageDir: join(root, 'runtime') })
      const fiber = await ctx.plugin(PlaywrightBrowser)
      const replacement = new PlaywrightBrowserProvider(resolvePlaywrightBrowserConfig(), () => Promise.reject(new Error('unused')))
      expect(() => ctx.browser.registerProvider(replacement)).toThrow(expect.objectContaining({
        code: 'BROWSER_PROVIDER_DUPLICATE',
      }))
      await fiber.dispose()
      const unregister = ctx.browser.registerProvider(replacement)
      unregister()
      await replacement.dispose()
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('fails the attach when the running browser exposes no context', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-browser-attach-empty-'))
    const ctx = new Context()
    const detach = vi.fn(async () => {})
    const connect = vi.spyOn(chromium, 'connectOverCDP').mockResolvedValue({
      contexts: () => [], close: detach,
    } as unknown as Browser)
    try {
      await ctx.plugin(createMockSettings({ browserChannel: 'chrome', attach: true, attachPort: 9333 }))
      await ctx.plugin(BrowserRuntime)
      ctx.provide('subprocess', { spawn: vi.fn(() => { throw new Error('Unexpected installer') }) } as never)
      await ctx.plugin(BrowserRuntimeManager, { storageDir: join(root, 'runtime') })
      const fiber = await ctx.plugin(PlaywrightBrowser, { storageDir: join(root, 'profile') })
      await expect(ctx.browser.listPages()).rejects.toMatchObject({
        code: 'BROWSER_PLAYWRIGHT_LAUNCH_FAILED',
        message: expect.stringContaining('Could not attach to the browser at http://127.0.0.1:9333'),
      })
      expect(detach).toHaveBeenCalledOnce()
      await fiber.dispose()
    } finally {
      await ctx.fiber.dispose()
      connect.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('launches the managed Chromium build for the chromium channel and honors an explicit executable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-browser-managed-'))
    const ctx = new Context()
    const context = new FakeContext()
    const launch = vi.spyOn(chromium, 'launchPersistentContext').mockResolvedValue(context as unknown as BrowserContext)
    try {
      const runtimeDir = join(root, 'runtime')
      await installManagedChromium(runtimeDir)
      await ctx.plugin(createMockSettings({ browserChannel: 'chromium' }))
      await ctx.plugin(BrowserRuntime)
      ctx.provide('subprocess', { spawn: vi.fn(() => { throw new Error('Unexpected installer') }) } as never)
      await ctx.plugin(BrowserRuntimeManager, { storageDir: runtimeDir })
      const custom = await ctx.plugin(PlaywrightBrowser, { storageDir: join(root, 'profile'), executablePath: 'C:/Browser/browser.exe' })
      await ctx.browser.listPages()
      expect(launch.mock.calls[0]?.[1]).toMatchObject({ executablePath: 'C:/Browser/browser.exe' })
      expect(launch.mock.calls[0]?.[1]).not.toHaveProperty('channel')
      await custom.dispose()

      const managed = await ctx.plugin(PlaywrightBrowser, { storageDir: join(root, 'profile') })
      await ctx.browser.listPages()
      const managedOptions = launch.mock.calls[1]?.[1] as Record<string, unknown>
      expect(managedOptions.executablePath?.toString().replaceAll('\\', '/')).toBe(join(runtimeDir, 'generation-fixture', runtimeMetadata.executableRelative).replaceAll('\\', '/'))
      expect(managedOptions).not.toHaveProperty('channel')
      await managed.dispose()
    } finally {
      await ctx.fiber.dispose()
      launch.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('publishes runtime state, releases the lease after a failed launch, and closes through the runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-browser-runtime-state-'))
    const ctx = new Context()
    const context = new FakeContext()
    const launch = vi.spyOn(chromium, 'launchPersistentContext')
    try {
      await ctx.plugin(createMockSettings({ browserChannel: 'chrome' }))
      await ctx.plugin(BrowserRuntime)
      ctx.provide('subprocess', { spawn: vi.fn(() => { throw new Error('Unexpected installer') }) } as never)
      await ctx.plugin(BrowserRuntimeManager, { storageDir: join(root, 'runtime') })
      launch.mockRejectedValueOnce(new Error('chrome missing'))
      const fiber = await ctx.plugin(PlaywrightBrowser, { storageDir: join(root, 'profile') })
      expect(ctx.browserRuntime.status()).toMatchObject({ providerActive: true, attached: false, browserState: 'stopped' })
      await expect(ctx.browser.listPages()).rejects.toMatchObject({ code: 'BROWSER_PLAYWRIGHT_LAUNCH_FAILED' })
      expect(ctx.browserRuntime.status().browserState).toBe('stopped')

      // A held lease would refuse this second acquisition, proving the failed launch released it.
      const release = await ctx.browserRuntime.acquireBrowserLease()
      await release()

      launch.mockResolvedValue(context as unknown as BrowserContext)
      await ctx.browser.listPages()
      expect(ctx.browserRuntime.status().browserState).toBe('running')
      await ctx.browserRuntime.closeBrowser()
      expect(context.close).toHaveBeenCalledOnce()
      expect(ctx.browserRuntime.status().browserState).toBe('stopped')
      await fiber.dispose()
    } finally {
      await ctx.fiber.dispose()
      launch.mockRestore()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('mounts the provider for a direct apply caller without a settings service', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-browser-direct-apply-'))
    const ctx = new Context()
    try {
      await ctx.plugin(BrowserRuntime)
      ctx.provide('subprocess', { spawn: vi.fn(() => { throw new Error('Unexpected installer') }) } as never)
      await ctx.plugin(BrowserRuntimeManager, { storageDir: join(root, 'runtime') })
      PlaywrightBrowser.apply(ctx, { storageDir: join(root, 'profile') })
      expect(ctx.get('settings')).toBeUndefined()
      expect(ctx.browserRuntime.status()).toMatchObject({ providerActive: true, browserState: 'stopped', channel: 'chrome' })
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

})

it('persists browser preferences, rejects invalid dimensions, and applies saved values only on remount', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-browser-preferences-'))
  const ctx = new Context()
  const launch = vi.spyOn(chromium, 'launchPersistentContext').mockImplementation(async () => new FakeContext() as unknown as BrowserContext)
  try {
    const settingsPath = join(root, 'settings.json')
    await ctx.plugin(createMockSettings({}, async (val) => {
      await writeFile(settingsPath, JSON.stringify({ 'browser-playwright': val }))
    }))
    await ctx.plugin(BrowserRuntime)
    ctx.provide('subprocess', { spawn: vi.fn(() => { throw new Error('Unexpected installer') }) } as never)
    await ctx.plugin(BrowserRuntimeManager, { storageDir: join(root, 'runtime') })
    const config = { storageDir: join(root, 'profile'), browserChannel: 'chrome' as const, headless: true }
    const first = await ctx.plugin(PlaywrightBrowser, config)
    expect(ctx.settings.describe()[0]).toMatchObject({ ns: 'browser-playwright', applies: 'restart' })
    await ctx.settings.update('browser-playwright', { browserChannel: 'msedge', viewportWidth: 800, viewportHeight: 600 })
    await expect(ctx.settings.update('browser-playwright', { viewportWidth: 0 })).rejects.toThrow()
    await expect(ctx.settings.update('browser-playwright', { storageDir: 'outside-profile' })).rejects.toThrow()
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toMatchObject({ 'browser-playwright': { browserChannel: 'msedge', viewportWidth: 800 } })
    await ctx.browser.listPages()
    expect(launch.mock.calls[0]?.[1]).toMatchObject({ channel: 'chrome', viewport: { width: 1440, height: 900 } })
    await first.dispose()
    expect(ctx.settings.describe()).toEqual([])
    await ctx.plugin(PlaywrightBrowser, config)
    await ctx.browser.listPages()
    expect(launch.mock.calls[1]?.[1]).toMatchObject({ channel: 'msedge', viewport: { width: 800, height: 600 } })
  } finally {
    await ctx.fiber.dispose()
    launch.mockRestore()
    await rm(root, { recursive: true, force: true })
  }
})

describe('native Browser extensions', () => {
  it('resolves home and search without launching and uses an isolated profile directory', async () => {
    const b = harness({ profileName: 'research', homePage: 'https://example.test/home', searchEngine: 'bing' })
    try {
      expect(b.provider.currentProfile()).toBe('research')
      expect(b.provider.resolveNavigation({ kind: 'home' })).toEqual({ url: 'https://example.test/home' })
      expect(b.provider.resolveNavigation({ kind: 'search', query: 'a & 中文' })).toEqual({ url: 'https://www.bing.com/search?q=a+%26+%E4%B8%AD%E6%96%87' })
      expect(b.launch).not.toHaveBeenCalled()
      await b.provider.listPages()
      expect(b.launch.mock.calls[0]![0].replaceAll('\\', '/')).toBe('C:/fixture/profile/harness-profiles/profile-research')
      for (const profileName of ['../escape', 'UPPER', 'a/b', 'a'.repeat(65)]) expect(() => resolvePlaywrightBrowserConfig({ profileName })).toThrow()
      for (const homePage of ['file:///not-allowed', 'javascript:void(0)', 'https://user:pass@example.test']) expect(() => resolvePlaywrightBrowserConfig({ homePage })).toThrow()
      expect(() => b.provider.resolveNavigation({ kind: 'search', query: 'q'.repeat(501) })).toThrow()
    } finally { await b.provider.dispose() }
  })

  it('bounds per-page visits and network metadata and returns detached observations', async () => {
    const b = harness({ maxHistoryEntries: 2, maxNetworkEntries: 2 })
    try {
      const pageId = (await b.provider.listPages())[0]!.pageId
      await b.provider.navigate({ pageId, url: 'https://example.test/one' })
      await b.provider.navigate({ pageId, url: 'https://example.test/two' })
      await b.provider.navigate({ pageId, url: 'https://example.test/three' })
      expect((await b.provider.history(pageId, 100)).map(row => row.url)).toEqual(['https://example.test/two', 'https://example.test/three'])
      const request = (path: string) => ({ url: () => 'https://example.test/' + path + '?token=fixture#fragment', method: () => 'GET', resourceType: () => 'fetch' })
      const one = request('one'), two = request('two'), three = request('three')
      b.context.initial.emit('request', one); b.context.initial.emit('request', two); b.context.initial.emit('request', three)
      b.context.initial.emit('response', { request: () => one, status: () => 200 })
      b.context.initial.emit('response', { request: () => two, status: () => 404 })
      b.context.initial.emit('response', { request: () => three, status: () => 200 })
      b.context.initial.emit('requestfailed', three)
      const observed = await b.provider.network(pageId, 100)
      expect(observed).toMatchObject([{ url: 'https://example.test/two', status: 404 }, { url: 'https://example.test/three', status: 200, failed: 'request-failed' }])
      expect(JSON.stringify(observed)).not.toContain('token=')
      Object.assign(observed[0]!, { status: 999 })
      expect((await b.provider.network(pageId, 100))[0]!.status).toBe(404)
      await expect(b.provider.network(pageId, 0)).rejects.toThrow()
      await expect(b.provider.history(pageId, 101)).rejects.toThrow()
      await b.provider.closePage({ pageId })
      await expect(b.provider.history(pageId, 10)).rejects.toThrow()
    } finally { await b.provider.dispose() }
  })

  it('rejects profile mismatch and invalid cookie input before launch and never echoes native errors', async () => {
    const b = harness({ maxCookieCount: 1 })
    const cookie = { name: 'fixture', value: 'fixture-only-value', domain: 'example.test' }
    try {
      await expect(b.provider.importCookies({ profileName: 'other', cookies: [cookie] })).rejects.toMatchObject({ code: 'BROWSER_PROFILE_MISMATCH' })
      await expect(b.provider.importCookies({ profileName: 'default', cookies: [cookie, cookie] })).rejects.toThrow()
      for (const patch of [
        { value: 'bad;value' }, { domain: '../bad' }, { path: 'relative' }, { sameSite: 'None' as const },
        { expires: Number.NaN }, { expires: -2 },
        { name: '__Secure-fixture' },
        { name: '__Host-fixture' },
        { name: '__Host-fixture', secure: true, path: '/other' },
        { name: '__Host-fixture', secure: true, path: '/', domain: '.example.test' },
      ]) {
        await expect(b.provider.importCookies({ profileName: 'default', cookies: [{ ...cookie, ...patch }] })).rejects.toMatchObject({ code: 'BROWSER_REQUEST_INVALID' })
      }
      const cancelled = new AbortController(); cancelled.abort(new Error('cancelled'))
      await expect(b.provider.importCookies({ profileName: 'default', cookies: [cookie] }, cancelled.signal)).rejects.toThrow('cancelled')
      expect(b.launch).not.toHaveBeenCalled()
      expect(await b.provider.importCookies({ profileName: 'default', cookies: [cookie] })).toEqual({ imported: 1 })
      expect(b.context.addCookies).toHaveBeenCalledWith([{ ...cookie, path: '/' }])
      const complete = { name: 'session', value: 'v', domain: 'example.test', path: '/', expires: 100, secure: true, httpOnly: true, sameSite: 'Lax' as const }
      await expect(b.provider.importCookies({ profileName: 'default', cookies: [complete] })).resolves.toEqual({ imported: 1 })
      expect(b.context.addCookies).toHaveBeenLastCalledWith([complete])
      b.context.addCookies.mockRejectedValueOnce(new Error('fixture-only-value'))
      await expect(b.provider.importCookies({ profileName: 'default', cookies: [cookie] })).rejects.toMatchObject({ message: 'The browser rejected the cookie import' })
    } finally { await b.provider.dispose() }
  })
})

it('caps downloads, verifies page ownership, and refuses unfinished or oversized reads', async () => {
  const b = harness({ maxDownloadCount: 1, maxTransferBytes: 4 })
  const settlement = Promise.withResolvers<string | null>()
  const download = { failure: () => settlement.promise, cancel: vi.fn(async () => {}),
    suggestedFilename: () => '../fixture.bin', createReadStream: vi.fn(async () => Readable.from([Buffer.from('12345')])) }
  try {
    const [page] = await b.provider.listPages()
    if (page === undefined) throw new Error('page missing')
    b.context.initial.emit('download', download)
    const first = await b.provider.downloads(page.pageId)
    expect(first.items).toMatchObject([{ name: 'fixture.bin', status: 'in-progress' }])
    const id = first.items[0]!.id
    await expect(b.provider.readDownload(page.pageId, id, 4)).rejects.toMatchObject({ code: 'BROWSER_DOWNLOAD_PENDING' })
    const second = { ...download, cancel: vi.fn(async () => {}) }
    b.context.initial.emit('download', second)
    expect(second.cancel).toHaveBeenCalledOnce()
    expect((await b.provider.downloads(page.pageId)).truncated).toBe(true)
    const foreign = await b.provider.openPage({ url: 'https://example.test/' })
    await expect(b.provider.readDownload(foreign.pageId, id, 4)).rejects.toMatchObject({ code: 'BROWSER_DOWNLOAD_NOT_FOUND' })
    settlement.resolve(null)
    await vi.waitFor(async () => { expect((await b.provider.downloads(page.pageId)).items[0]!.status).toBe('complete') })
    await expect(b.provider.readDownload(page.pageId, id, 4)).rejects.toMatchObject({ code: 'BROWSER_TRANSFER_TOO_LARGE' })
    await b.provider.closePage({ pageId: page.pageId })
    expect(download.cancel).toHaveBeenCalledOnce()
  } finally { settlement.resolve(null); await b.provider.dispose() }
})

it('stops matching network responses after a request settles and ignores events from a closed page', async () => {
  const b = harness()
  const [page] = await b.provider.listPages()
  if (page === undefined) throw new Error('page missing')
  try {
    const settled = { url: () => 'https://example.test/settled', method: () => 'GET', resourceType: () => 'fetch' }
    b.context.initial.emit('request', settled)
    b.context.initial.emit('requestfinished', settled)
    b.context.initial.emit('response', { request: () => settled, status: () => 200 })
    const unresolvable = { url: () => 'not a url', method: () => 'GET', resourceType: () => 'fetch' }
    b.context.initial.emit('request', unresolvable)
    const observed = await b.provider.network(page.pageId, 10)
    expect(observed).toMatchObject([{ url: 'https://example.test/settled' }, { url: 'about:blank' }])
    expect(observed[0]).not.toHaveProperty('status')

    await b.context.initial.close()
    b.context.initial.emit('request', settled)
    b.context.initial.emit('response', { request: () => settled, status: () => 200 })
    b.context.initial.emit('requestfailed', settled)
    b.context.initial.emit('framenavigated', b.context.initial.frame)
    await expect(b.provider.network(page.pageId, 10)).rejects.toMatchObject({ code: 'BROWSER_PAGE_NOT_FOUND' })
  } finally { await b.provider.dispose() }
})

it('records failed downloads and swallows cancellation failures', async () => {
  const b = harness({ maxDownloadCount: 2 })
  const settlement = Promise.withResolvers<string | null>()
  const rejected = Promise.withResolvers<string | null>()
  const cancel = vi.fn(() => Promise.reject(new Error('cancel failed')))
  const broken = { failure: () => settlement.promise, cancel, suggestedFilename: () => 'broken.bin', createReadStream: vi.fn() }
  const unreadable = { failure: () => rejected.promise, cancel: vi.fn(async () => {}), suggestedFilename: () => 'unreadable.bin', createReadStream: vi.fn() }
  const refused = { failure: () => Promise.resolve(null), cancel: vi.fn(() => Promise.reject(new Error('cancel failed'))), suggestedFilename: () => 'refused.bin', createReadStream: vi.fn() }
  try {
    const [page] = await b.provider.listPages()
    if (page === undefined) throw new Error('page missing')
    b.context.initial.emit('download', broken)
    b.context.initial.emit('download', unreadable)
    settlement.resolve('network error')
    rejected.reject(new Error('transfer aborted'))
    await vi.waitFor(async () => {
      expect((await b.provider.downloads(page.pageId)).items.map(item => item.status)).toEqual(['failed', 'failed'])
    })
    b.context.initial.emit('download', refused)
    expect(refused.cancel).toHaveBeenCalledOnce()
    expect((await b.provider.downloads(page.pageId)).truncated).toBe(true)
    await b.provider.closePage({ pageId: page.pageId })
    expect(cancel).toHaveBeenCalledOnce()
  } finally { settlement.resolve(null); await b.provider.dispose() }
})

it('reads a completed download and maps read failures', async () => {
  const b = harness({ maxTransferBytes: 1024 })
  const settlement = Promise.withResolvers<string | null>()
  const readable = {
    failure: () => settlement.promise,
    cancel: vi.fn(async () => {}),
    suggestedFilename: () => 'fixture.bin',
    createReadStream: vi.fn(async () => Readable.from([Buffer.from('payload')])),
  }
  const unreadable = {
    failure: () => Promise.resolve(null),
    cancel: vi.fn(async () => {}),
    suggestedFilename: () => 'broken.bin',
    createReadStream: vi.fn(async () => { throw new Error('stream unavailable') }),
  }
  try {
    const [page] = await b.provider.listPages()
    if (page === undefined) throw new Error('page missing')
    b.context.initial.emit('download', readable)
    b.context.initial.emit('download', unreadable)
    settlement.resolve(null)
    await vi.waitFor(async () => {
      expect((await b.provider.downloads(page.pageId)).items.map(item => item.status)).toEqual(['complete', 'complete'])
    })
    const items = (await b.provider.downloads(page.pageId)).items
    const readableId = items.find(item => item.name === 'fixture.bin')!.id
    const unreadableId = items.find(item => item.name === 'broken.bin')!.id
    await expect(b.provider.readDownload(page.pageId, readableId, 1024))
      .resolves.toEqual({ name: 'fixture.bin', data: Uint8Array.from(Buffer.from('payload')) })
    await expect(b.provider.readDownload(page.pageId, unreadableId, 1024))
      .rejects.toMatchObject({ code: 'BROWSER_DOWNLOAD_FAILED', message: 'Download data is unavailable' })
  } finally { settlement.resolve(null); await b.provider.dispose() }
})

it('returns empty history and downloads when the page closes during the read', async () => {
  const b = harness()
  const [page] = await b.provider.listPages()
  if (page === undefined) throw new Error('page missing')
  try {
    await b.provider.navigate({ pageId: page.pageId, url: 'https://example.test/one' })
    const history = b.provider.history(page.pageId, 10)
    await b.context.initial.close()
    await expect(history).resolves.toEqual([])
  } finally { await b.provider.dispose() }

  const downloads = harness()
  const [downloadPage] = await downloads.provider.listPages()
  if (downloadPage === undefined) throw new Error('page missing')
  try {
    const pending = downloads.provider.downloads(downloadPage.pageId)
    await downloads.context.initial.close()
    await expect(pending).resolves.toEqual({ items: [], truncated: false })
  } finally { await downloads.provider.dispose() }
})

it('navigates back and forward through page history and maps traversal failures', async () => {
  const b = harness()
  const [page] = await b.provider.listPages()
  if (page === undefined) throw new Error('page missing')
  try {
    await b.provider.navigate({ pageId: page.pageId, url: 'https://example.test/one' })
    b.context.initial.backUrl = 'https://example.test/home'
    await expect(b.provider.back(page.pageId)).resolves.toMatchObject({ pageId: page.pageId, url: 'https://example.test/home', title: 'Fixture' })
    expect((await b.provider.history(page.pageId, 100)).map(entry => entry.url)).toContain('https://example.test/home')

    b.context.initial.forwardUrl = 'https://example.test/one'
    await expect(b.provider.forward(page.pageId)).resolves.toMatchObject({ url: 'https://example.test/one' })

    b.context.initial.forwardFailure = new Error('forward failed')
    await expect(b.provider.forward(page.pageId)).rejects.toMatchObject({ code: 'BROWSER_NAVIGATION_FAILED', message: "Could not traverse browser page '" + page.pageId + "'" })

    b.context.initial.backFailure = new BrowserError('browser page was closed', 'BROWSER_PAGE_CLOSED')
    await expect(b.provider.back(page.pageId)).rejects.toMatchObject({ code: 'BROWSER_PAGE_CLOSED' })

    const cancelled = new AbortController()
    cancelled.abort(new Error('traversal stopped'))
    await expect(b.provider.back(page.pageId, cancelled.signal)).rejects.toThrow('traversal stopped')

    await b.provider.closePage({ pageId: page.pageId })
    await expect(b.provider.back(page.pageId)).rejects.toMatchObject({ code: 'BROWSER_PAGE_NOT_FOUND' })
  } finally { await b.provider.dispose() }
})

it('uploads bytes to an observation-bound file input and consumes the observation', async () => {
  const b = harness()
  const [page] = await b.provider.listPages()
  if (page === undefined) throw new Error('page missing')
  try {
    const observation = await b.provider.snapshot({ pageId: page.pageId })
    const target = {
      pageId: page.pageId,
      observationId: observation.observationId,
      elementId: observation.elements[0]!.elementId,
    }
    await expect(b.provider.upload({ ...target, name: 'notes.txt', data: Uint8Array.of(1, 2, 3) })).resolves.toBeUndefined()
    expect(b.context.initial.element.setInputFiles).toHaveBeenCalledWith({
      name: 'notes.txt', mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 3]),
    })
    expect(b.context.initial.element.dispose).toHaveBeenCalledOnce()
    await expect(b.provider.upload({ ...target, name: 'notes.txt', data: Uint8Array.of(1) }))
      .rejects.toMatchObject({ code: 'BROWSER_OBSERVATION_STALE' })
  } finally { await b.provider.dispose() }
})

it('rejects invalid uploads before touching the page and maps input failures', async () => {
  const b = harness({ maxTransferBytes: 2 })
  let observationId = BrowserObservationId('missing')
  let elementId = BrowserElementId('e1')
  const request = (overrides: Record<string, unknown> = {}) => ({
    pageId: BrowserPageId('missing'), observationId, elementId, name: 'notes.txt', data: Uint8Array.of(1), ...overrides,
  })
  try {
    await expect(b.provider.upload(request({ name: '../escape.txt' }))).rejects.toMatchObject({ code: 'BROWSER_REQUEST_INVALID' })
    await expect(b.provider.upload(request({ data: Uint8Array.of(1, 2, 3) })))
      .rejects.toMatchObject({ code: 'BROWSER_TRANSFER_TOO_LARGE', message: 'Upload exceeds the configured byte limit' })
    await expect(b.provider.upload(request())).rejects.toMatchObject({ code: 'BROWSER_PAGE_NOT_FOUND' })

    const [page] = await b.provider.listPages()
    if (page === undefined) throw new Error('page missing')
    await expect(b.provider.upload(request({ pageId: page.pageId }))).rejects.toMatchObject({ code: 'BROWSER_OBSERVATION_STALE' })

    const observation = await b.provider.snapshot({ pageId: page.pageId })
    observationId = observation.observationId
    elementId = BrowserElementId('e9')
    await expect(b.provider.upload(request({ pageId: page.pageId })))
      .rejects.toMatchObject({ code: 'BROWSER_ELEMENT_STALE', message: 'File input is absent from observation' })

    elementId = observation.elements[0]!.elementId
    b.context.initial.element.fingerprints = [{ tagName: 'button', role: 'button', name: 'Changed', text: 'Changed' }]
    await expect(b.provider.upload(request({ pageId: page.pageId })))
      .rejects.toMatchObject({ code: 'BROWSER_ELEMENT_CHANGED', message: 'File input changed since observation' })

    const failed = harness()
    const [failedPage] = await failed.provider.listPages()
    if (failedPage === undefined) throw new Error('page missing')
    const failedObservation = await failed.provider.snapshot({ pageId: failedPage.pageId })
    const failedTarget = {
      pageId: failedPage.pageId,
      observationId: failedObservation.observationId,
      elementId: failedObservation.elements[0]!.elementId,
      name: 'notes.txt',
      data: Uint8Array.of(1),
    }
    failed.context.initial.element.uploadFailure = new Error('input rejected')
    await expect(failed.provider.upload(failedTarget))
      .rejects.toMatchObject({ code: 'BROWSER_UPLOAD_FAILED', message: 'Could not set browser file input' })
    const retried = await failed.provider.snapshot({ pageId: failedPage.pageId })
    failed.context.initial.element.uploadFailure = new BrowserError('browser page was closed', 'BROWSER_PAGE_CLOSED')
    await expect(failed.provider.upload({
      ...failedTarget, observationId: retried.observationId, elementId: retried.elements[0]!.elementId,
    })).rejects.toMatchObject({ code: 'BROWSER_PAGE_CLOSED' })
    await failed.provider.dispose()
  } finally { await b.provider.dispose() }
})

it('records repeated visits to one URL without duplicating history entries', async () => {
  const b = harness()
  const [page] = await b.provider.listPages()
  if (page === undefined) throw new Error('page missing')
  try {
    await b.provider.navigate({ pageId: page.pageId, url: 'https://example.test/one' })
    await b.provider.navigate({ pageId: page.pageId, url: 'https://example.test/one' })
    b.context.initial.emit('framenavigated', b.context.initial.frame)
    b.context.initial.emit('framenavigated', b.context.initial.frame)
    const history = await b.provider.history(page.pageId, 100)
    expect(history.map(entry => entry.url)).toEqual(['https://example.test/one'])
  } finally { await b.provider.dispose() }
})

it('surfaces a page that closes while opening or navigating', async () => {
  const open = harness()
  const created = new FakePage()
  let resolveOpen!: () => void
  created.goto.mockImplementationOnce(() => new Promise((resolve) => { resolveOpen = () => { resolve(null) } }))
  open.context.newPage.mockResolvedValueOnce(created as unknown as Page)
  const pendingOpen = open.provider.openPage({ url: 'https://open.test' })
  await vi.waitFor(() => { expect(created.goto).toHaveBeenCalledOnce() })
  await created.close()
  await expect(pendingOpen).rejects.toMatchObject({ code: 'BROWSER_PAGE_CLOSED' })
  resolveOpen()
  await open.provider.dispose()

  const navigate = harness()
  const [page] = await navigate.provider.listPages()
  if (page === undefined) throw new Error('page missing')
  let resolveNavigate!: () => void
  navigate.context.initial.goto.mockImplementationOnce(() => new Promise((resolve) => {
    resolveNavigate = () => { resolve(null) }
  }))
  const pendingNavigate = navigate.provider.navigate({ pageId: page.pageId, url: 'https://navigate.test' })
  await vi.waitFor(() => { expect(navigate.context.initial.goto).toHaveBeenCalledOnce() })
  await navigate.context.initial.close()
  await expect(pendingNavigate).rejects.toMatchObject({ code: 'BROWSER_PAGE_CLOSED' })
  resolveNavigate()
  await navigate.provider.dispose()
})

it('supports remote debugging port and exposes cdpEndpoint', async () => {
  const b = harness({ remoteDebuggingPort: 9222 })
  try {
    expect(b.provider.cdpEndpoint()).toBe('http://127.0.0.1:9222')
    await b.provider.listPages()
    expect(b.launch).toHaveBeenCalledOnce()
    const options = b.launch.mock.calls[0]?.[1] as { args?: string[] } | undefined
    expect(options?.args).toContain('--remote-debugging-port=9222')
  } finally {
    await b.provider.dispose()
  }
})

it('validates remoteDebuggingPort range and rejects invalid ports', () => {
  expect(() => resolvePlaywrightBrowserConfig({ remoteDebuggingPort: 80 })).toThrow(/between 1024 and 65535/)
  expect(() => resolvePlaywrightBrowserConfig({ remoteDebuggingPort: 70000 })).toThrow(/between 1024 and 65535/)
  expect(resolvePlaywrightBrowserConfig({ remoteDebuggingPort: 9222 }).remoteDebuggingPort).toBe(9222)
})
