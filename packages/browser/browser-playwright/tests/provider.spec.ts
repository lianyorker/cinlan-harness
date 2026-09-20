/* oxlint-disable typescript/no-unsafe-assignment -- Vitest asymmetric matchers are typed as any. */
import { Context } from '@deepseek-ai/cordis'
import { Readable } from 'node:stream'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import BrowserRuntime, {
  BrowserElementId,
  BrowserObservationId,
  BrowserPageId,
} from '@deepseek-ai/dsh-browser'
import { chromium } from 'playwright-core'
import type { BrowserContext, ElementHandle, Locator, Page } from 'playwright-core'
import { describe, expect, it, vi } from 'vitest'
import {
  PlaywrightBrowserProvider,
  resolvePlaywrightBrowserConfig,
} from '../src/index.ts'
import * as PlaywrightBrowser from '../src/index.ts'
import BrowserRuntimeManager from '../src/runtime.ts'

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
}

interface FakeBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

class FakeElement {
  clickFailure: Error | undefined
  evaluateFailure: Error | undefined
  boundingBoxFailure: Error | undefined
  fingerprints: FakeFingerprint[] = [{ tagName: 'button', role: 'button', name: 'Continue', text: 'Continue' }]
  boxes: Array<FakeBox | null> = [{ x: 10, y: 20, width: 30, height: 40 }]
  readonly click = vi.fn(async () => {
    if (this.clickFailure !== undefined) throw this.clickFailure
  })
  readonly dispose = vi.fn(() => Promise.resolve())
  readonly boundingBox = vi.fn(async () => {
    if (this.boundingBoxFailure !== undefined) throw this.boundingBoxFailure
    const value = this.boxes.length > 1 ? this.boxes.shift() : this.boxes[0]
    return value ?? null
  })
  evaluate<T>(callback: (node: Element) => T): Promise<T> {
    if (this.evaluateFailure !== undefined) return Promise.reject(this.evaluateFailure)
    const value = this.fingerprints.length > 1 ? this.fingerprints.shift() : this.fingerprints[0]
    if (value === undefined) return Promise.reject(new Error('missing fake element fingerprint'))
    const node = {
      tagName: value.tagName.toUpperCase(),
      getAttribute: (name: string) => name === 'role' ? value.role : name === 'aria-label' ? value.name : null,
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
  viewportFailure: Error | undefined
  overlayCleanupCalls = 0
  ariaFailure: Error | undefined
  gotoFailure: Error | undefined
  screenshotFailure: Error | undefined
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
      return Promise.resolve(undefined as T)
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

describe('Playwright browser Cordis plugins', () => {
  it('registers and removes the Browser provider without launching it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-browser-preferences-'))
    const ctx = new Context()
    try {
      await ctx.plugin(FileSettingsProvider, { path: join(root, 'settings.json'), watch: false })
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

})

it('persists browser preferences, rejects invalid dimensions, and applies saved values only on remount', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-browser-preferences-'))
  const ctx = new Context()
  const launch = vi.spyOn(chromium, 'launchPersistentContext').mockImplementation(async () => new FakeContext() as unknown as BrowserContext)
  try {
    const settingsPath = join(root, 'settings.json')
    await ctx.plugin(FileSettingsProvider, { path: settingsPath, watch: false })
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
      for (const patch of [{ value: 'bad;value' }, { domain: '../bad' }, { path: 'relative' }, { sameSite: 'None' as const }, { expires: Number.NaN }]) {
        await expect(b.provider.importCookies({ profileName: 'default', cookies: [{ ...cookie, ...patch }] })).rejects.toMatchObject({ code: 'BROWSER_REQUEST_INVALID' })
      }
      const cancelled = new AbortController(); cancelled.abort(new Error('cancelled'))
      await expect(b.provider.importCookies({ profileName: 'default', cookies: [cookie] }, cancelled.signal)).rejects.toThrow('cancelled')
      expect(b.launch).not.toHaveBeenCalled()
      expect(await b.provider.importCookies({ profileName: 'default', cookies: [cookie] })).toEqual({ imported: 1 })
      expect(b.context.addCookies).toHaveBeenCalledWith([{ ...cookie, path: '/' }])
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
