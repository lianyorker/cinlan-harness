/**
 * Harness-owned persistent browser provider backed by Playwright and a
 * dedicated profile under DSH_HOME.
 * @module @deepseek-ai/dsh-browser-playwright
 */

import { randomUUID } from 'node:crypto'
import { assertUploadName, downloadBytes, downloadName } from './transfers.ts'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { join } from 'node:path'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-settings'
import type { BrowserPreferences } from './types.ts'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  BrowserElementId,
  BrowserElementSelectionId,
  BrowserError,
  BrowserObservationId,
  BrowserPageId,
} from '@deepseek-ai/dsh-browser'
import type {
  BrowserAutomationProvider,
  BrowserTransferProvider,
  BrowserDownload,
  BrowserDownloadId,
  BrowserDownloadedFile,
  BrowserUploadRequest,
  BrowserClickRequest,
  BrowserCookieInput,
  BrowserCookieImportRequest,
  BrowserNavigationTarget,
  BrowserHistoryEntry,
  BrowserNetworkEntry,
  BrowserClickResult,
  BrowserCloseRequest,
  BrowserElement,
  BrowserElementCaptureProvider,
  BrowserElementCaptureRequest,
  BrowserElementScreenshot,
  BrowserElementSelection,
  BrowserElementSelectionRequest,
  BrowserNavigateRequest,
  BrowserNavigateResult,
  BrowserObservation,
  BrowserOpenRequest,
  BrowserOpenResult,
  BrowserPage,
  BrowserRect,
  BrowserScreenshot,
  BrowserScreenshotRequest,
  BrowserSnapshotRequest,
} from '@deepseek-ai/dsh-browser'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { chromium } from 'playwright-core'
import type { BrowserContext, Download, ElementHandle, Page, Request as PlaywrightRequest } from 'playwright-core'

/** Cordis plugin name. */
export const name = 'browser-playwright'

/** Browser Service Definition required by this Provider. */
export const inject = ['browser', 'settings']

const DEFAULT_ACTION_TIMEOUT_MS = 30_000
const DEFAULT_NAVIGATION_TIMEOUT_MS = 60_000
const DEFAULT_MAX_ELEMENTS = 200
const DEFAULT_VIEWPORT_WIDTH = 1440
const DEFAULT_VIEWPORT_HEIGHT = 900
const DEFAULT_MAX_CAPTURE_BYTES = 10 * 1024 * 1024
const DEFAULT_MAX_CAPTURE_PIXELS = 4_000_000
const DEFAULT_SELECTION_TIMEOUT_MS = 60_000
const INTERACTIVE_SELECTOR = 'a[href],button,input:not([type="hidden"]),select,textarea,summary,[role],[tabindex]:not([tabindex="-1"])'
const CONFIG_KEYS = new Set([
  'providerId', 'storageDir', 'browserChannel', 'executablePath', 'headless', 'profileName', 'homePage', 'searchEngine', 'maxHistoryEntries', 'maxNetworkEntries', 'maxCookieCount', 'maxDownloadCount', 'maxTransferBytes',
  'actionTimeoutMs', 'navigationTimeoutMs', 'maxElements', 'viewportWidth', 'viewportHeight',
  'maxCaptureBytes', 'maxCapturePixels', 'selectionTimeoutMs',
])

type BrowserChannel = 'chrome' | 'msedge' | 'chromium'

/** Playwright browser deployment settings. */
export interface Config {
  /** Provider id registered with ctx.browser. Defaults to `local`. */
  readonly providerId?: string
  /** Persistent profile directory. Defaults to `$DSH_HOME/browser/profile`. */
  readonly storageDir?: string
  /** Installed browser channel. Defaults to `chrome`. */
  readonly browserChannel?: BrowserChannel
  /** Explicit browser executable path, which takes precedence over browserChannel. */
  readonly executablePath?: string
  /** Whether the browser runs without visible windows. Defaults to false. */
  readonly headless?: boolean
  /** Named persistent profile; `default` uses storageDir directly. */
  readonly profileName?: string
  /** New-page destination used by home navigation. Defaults to about:blank. */
  readonly homePage?: string
  /** Search engine for explicit searches. Defaults to google. */
  readonly searchEngine?: BrowserPreferences['searchEngine']
  /** Maximum visits retained per open page. Defaults to 100. */
  readonly maxHistoryEntries?: number
  /** Maximum requests retained per open page. Defaults to 100. */
  readonly maxNetworkEntries?: number
  /** Maximum cookies accepted per import. Defaults to 100. */
  readonly maxCookieCount?: number
  /** Maximum retained downloads per page; later downloads are canceled. Defaults to 20. */
  readonly maxDownloadCount?: number
  /** Maximum bytes per upload or download read. Defaults to 4 MiB. */
  readonly maxTransferBytes?: number
  /** Playwright action and launch timeout. Defaults to 30000 ms. */
  readonly actionTimeoutMs?: number
  /** Page navigation timeout. Defaults to 60000 ms. */
  readonly navigationTimeoutMs?: number
  /** Maximum interactive references returned by one snapshot. Defaults to 200. */
  readonly maxElements?: number
  /** Viewport width. Defaults to 1440. */
  readonly viewportWidth?: number
  /** Viewport height. Defaults to 900. */
  readonly viewportHeight?: number
  /** Maximum encoded bytes returned by one element capture. Defaults to 10 MiB. */
  readonly maxCaptureBytes?: number
  /** Maximum visible CSS pixels captured by one element operation. Defaults to 4 million. */
  readonly maxCapturePixels?: number
  /** Maximum time waiting for an overlay selection. Defaults to 60000 ms. */
  readonly selectionTimeoutMs?: number
}

/** Fully validated Playwright provider settings. */
export interface ResolvedConfig {
  readonly providerId: string
  readonly storageDir: string
  readonly browserChannel: BrowserChannel
  readonly executablePath?: string
  readonly headless: boolean
  readonly profileName: string
  readonly homePage: string
  readonly searchEngine: BrowserPreferences['searchEngine']
  readonly maxHistoryEntries: number
  readonly maxNetworkEntries: number
  readonly maxCookieCount: number
  readonly maxDownloadCount: number
  readonly maxTransferBytes: number
  readonly actionTimeoutMs: number
  readonly navigationTimeoutMs: number
  readonly maxElements: number
  readonly viewportWidth: number
  readonly viewportHeight: number
  readonly maxCaptureBytes: number
  readonly maxCapturePixels: number
  readonly selectionTimeoutMs: number
}

/** User preferences exclude executable paths, profile storage, and provider identity. */
const PREFERENCE_KEYS = new Set(['browserChannel', 'headless', 'viewportWidth', 'viewportHeight', 'profileName', 'homePage', 'searchEngine'])
const BrowserPreferencesSchema: z<BrowserPreferences> = z.object({
  browserChannel: z.union(['chrome', 'msedge', 'chromium'] as const).default('chrome'),
  headless: z.boolean().default(false),
  viewportWidth: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_VIEWPORT_WIDTH),
  viewportHeight: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_VIEWPORT_HEIGHT),
  profileName: z.string().default('default'),
  homePage: z.string().default('about:blank'),
  searchEngine: z.union(['google', 'bing', 'duckduckgo'] as const).default('google'),
})

/** Loader schema for Playwright browser settings. */
export const Config: z<Config> = z.object({
  providerId: z.string().default('local'),
  storageDir: z.string(),
  browserChannel: z.union(['chrome', 'msedge', 'chromium'] as const).default('chrome'),
  profileName: z.string().default('default'),
  homePage: z.string().default('about:blank'),
  searchEngine: z.union(['google', 'bing', 'duckduckgo'] as const).default('google'),
  maxHistoryEntries: z.number().step(1).min(1).max(1000).default(100),
  maxNetworkEntries: z.number().step(1).min(1).max(1000).default(100),
  maxCookieCount: z.number().step(1).min(1).max(1000).default(100),
  maxDownloadCount: z.number().step(1).min(1).max(1000).default(20),
  maxTransferBytes: z.number().step(1).min(1).max(100 * 1024 * 1024).default(4 * 1024 * 1024),
  executablePath: z.string(),
  headless: z.boolean().default(false),
  actionTimeoutMs: z.number().default(DEFAULT_ACTION_TIMEOUT_MS),
  navigationTimeoutMs: z.number().default(DEFAULT_NAVIGATION_TIMEOUT_MS),
  maxElements: z.number().default(DEFAULT_MAX_ELEMENTS),
  viewportWidth: z.number().default(DEFAULT_VIEWPORT_WIDTH),
  viewportHeight: z.number().default(DEFAULT_VIEWPORT_HEIGHT),
  maxCaptureBytes: z.number().default(DEFAULT_MAX_CAPTURE_BYTES),
  maxCapturePixels: z.number().default(DEFAULT_MAX_CAPTURE_PIXELS),
  selectionTimeoutMs: z.number().default(DEFAULT_SELECTION_TIMEOUT_MS),
})

function cleanString(name: string, value: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`browser-playwright: ${name} must be non-empty without surrounding whitespace`)
  }
  return value
}

function profileName(value: string): string {
  const normalized = cleanString('profileName', value)
  if (! /^[a-z][a-z0-9_-]{0,63}$/.test(normalized)) {
    throw new Error('browser-playwright: profileName must start with a lowercase letter and contain at most 64 lowercase letters, digits, underscores, or hyphens')
  }
  return normalized
}

function browserUrl(name: string, value: string): string {
  const normalized = cleanString(name, value)
  if (normalized === 'about:blank') return normalized
  if (normalized.length > 8192) throw new Error(`browser-playwright: ${name} is too long`)
  let parsed: URL
  try { parsed = new URL(normalized) } catch { throw new Error(`browser-playwright: ${name} must be an HTTP or HTTPS URL`) }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`browser-playwright: ${name} must be an HTTP or HTTPS URL`)
  if (parsed.username || parsed.password) throw new Error(`browser-playwright: ${name} must not contain credentials`)
  return normalized
}

function transferLimit(value: number): number {
  positiveInteger('maxTransferBytes', value)
  if (value > 100 * 1024 * 1024) throw new Error('browser-playwright: maxTransferBytes exceeds 100 MiB')
  return value
}

function entryLimit(name: string, value: number): number {
  positiveInteger(name, value)
  if (value > 1000) throw new Error(`browser-playwright: ${name} must not exceed 1000`)
  return value
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`browser-playwright: ${name} must be a positive safe integer`)
  }
  return value
}

/**
 * Validate and default Playwright browser settings.
 * @param config - loader or direct plugin configuration.
 * @returns complete provider settings.
 */
export function resolvePlaywrightBrowserConfig(config: Config = {}): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`browser-playwright: unsupported config key '${key}'`)
  }
  const browserChannel = config.browserChannel ?? 'chrome'
  if (!['chrome', 'msedge', 'chromium'].includes(browserChannel)) {
    throw new Error('browser-playwright: browserChannel must be chrome, msedge, or chromium')
  }
  const searchEngine = config.searchEngine ?? 'google'
  if (!['google', 'bing', 'duckduckgo'].includes(searchEngine)) throw new Error('browser-playwright: searchEngine is invalid')
  const executablePath = config.executablePath === undefined
    ? undefined
    : cleanString('executablePath', config.executablePath)
  return {
    providerId: cleanString('providerId', config.providerId ?? 'local'),
    storageDir: cleanString('storageDir', config.storageDir ?? dshHomePath('browser', 'profile')),
    browserChannel,
    profileName: profileName(config.profileName ?? 'default'),
    homePage: browserUrl('homePage', config.homePage ?? 'about:blank'),
    searchEngine,
    maxHistoryEntries: entryLimit('maxHistoryEntries', config.maxHistoryEntries ?? 100),
    maxNetworkEntries: entryLimit('maxNetworkEntries', config.maxNetworkEntries ?? 100),
    maxCookieCount: entryLimit('maxCookieCount', config.maxCookieCount ?? 100),
    maxDownloadCount: entryLimit('maxDownloadCount', config.maxDownloadCount ?? 20),
    maxTransferBytes: transferLimit(config.maxTransferBytes ?? 4 * 1024 * 1024),
    ...(executablePath === undefined ? {} : { executablePath }),
    headless: config.headless ?? false,
    actionTimeoutMs: positiveInteger('actionTimeoutMs', config.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS),
    navigationTimeoutMs: positiveInteger('navigationTimeoutMs', config.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS),
    maxElements: positiveInteger('maxElements', config.maxElements ?? DEFAULT_MAX_ELEMENTS),
    viewportWidth: positiveInteger('viewportWidth', config.viewportWidth ?? DEFAULT_VIEWPORT_WIDTH),
    viewportHeight: positiveInteger('viewportHeight', config.viewportHeight ?? DEFAULT_VIEWPORT_HEIGHT),
    maxCaptureBytes: positiveInteger('maxCaptureBytes', config.maxCaptureBytes ?? DEFAULT_MAX_CAPTURE_BYTES),
    maxCapturePixels: positiveInteger('maxCapturePixels', config.maxCapturePixels ?? DEFAULT_MAX_CAPTURE_PIXELS),
    selectionTimeoutMs: positiveInteger('selectionTimeoutMs', config.selectionTimeoutMs ?? DEFAULT_SELECTION_TIMEOUT_MS),
  }
}

interface ObservationState {
  readonly id: ReturnType<typeof BrowserObservationId>
  readonly elements: ReadonlyMap<ReturnType<typeof BrowserElementId>, ElementHandle>
  readonly fingerprints: ReadonlyMap<ReturnType<typeof BrowserElementId>, ElementFingerprint>
}

interface ElementFingerprint {
  readonly tagName: string
  readonly role: string
  readonly name: string
  readonly text: string
}

interface RawOverlaySelection extends ElementFingerprint {
  readonly key: string
  readonly rect: BrowserRect
}

interface SelectionState {
  readonly pageId: ReturnType<typeof BrowserPageId>
  readonly handle: ElementHandle
  readonly fingerprint: ElementFingerprint
}

/** Temporary page overlay used for user-driven element selection. */
function selectElementInPage(key: string): Promise<RawOverlaySelection | null> {
  const overlayId = '__dsh_browser_element_capture_overlay__'
  const attribute = 'data-dsh-browser-element'
  const win = window as Window & {
    __dshBrowserElementCapture?: { key: string; cleanup(): void }
  }
  win.__dshBrowserElementCapture?.cleanup()
  return new Promise((resolve) => {
    let hovered: Element | null = null
    const overlay = document.createElement('div')
    overlay.id = overlayId
    overlay.setAttribute('aria-hidden', 'true')
    Object.assign(overlay.style, {
      position: 'fixed',
      zIndex: '2147483647',
      pointerEvents: 'none',
      border: '2px solid #1677ff',
      background: 'rgba(22, 119, 255, 0.12)',
      boxSizing: 'border-box',
      display: 'none',
    })
    document.documentElement.append(overlay)

    const metadata = (target: Element): RawOverlaySelection => {
      const rect = target.getBoundingClientRect()
      const tagName = target.tagName.toLowerCase()
      const role = target.getAttribute('role') ?? tagName
      const name = target.getAttribute('aria-label')
        ?? target.getAttribute('title')
        ?? target.textContent.trim().slice(0, 200)
      return {
        key, tagName, role, name, text: target.textContent.trim().slice(0, 500),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      }
    }
    let settled = false
    const finish = (result: RawOverlaySelection | null): void => {
      if (settled) return
      settled = true
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('keydown', onKeyDown, true)
      overlay.remove()
      if (win.__dshBrowserElementCapture?.key === key) delete win.__dshBrowserElementCapture
      resolve(result)
    }
    const onMove = (event: MouseEvent): void => {
      if (!(event.target instanceof Element)) return
      hovered = event.target
      const rect = hovered.getBoundingClientRect()
      Object.assign(overlay.style, {
        display: rect.width > 0 && rect.height > 0 ? 'block' : 'none',
        left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px`,
      })
    }
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Element)) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      const target = hovered === null ? event.target : hovered
      const rect = target.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) { finish(null); return }
      target.setAttribute(attribute, key)
      finish(metadata(target))
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      finish(null)
    }
    win.__dshBrowserElementCapture = { key, cleanup: () => { finish(null) } }
    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('click', onClick, true)
    document.addEventListener('keydown', onKeyDown, true)
  })
}

/** Remove a selection overlay after cancellation, navigation, or provider disposal. */
function clearElementOverlay(): void {
  const win = window as Window & {
    __dshBrowserElementCapture?: { key: string; cleanup(): void }
  }
  win.__dshBrowserElementCapture?.cleanup()
}

/** Remove the private marker used to recover the element handle after selection. */
function removeSelectionMarker(key: string): void {
  for (const element of document.querySelectorAll('[data-dsh-browser-element]')) {
    if (element.getAttribute('data-dsh-browser-element') === key) element.removeAttribute('data-dsh-browser-element')
  }
}

type ContextLauncher = (
  userDataDir: string,
  options: NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>,
) => Promise<BrowserContext>

function browserFailure(message: string, code: string, cause?: unknown): BrowserError {
  return new BrowserError(message, code, cause === undefined ? undefined : { cause })
}

function clickFailure(elementId: ReturnType<typeof BrowserElementId>, error: unknown): BrowserError {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  if (/not attached|detached|no longer.*dom|element.*stale/iu.test(detail)) {
    return browserFailure(
      `Could not click element '${elementId}': the element detached; take a new snapshot`,
      'BROWSER_ELEMENT_STALE',
      error,
    )
  }
  if (/timeouterror|timeout[\s\S]*exceeded|timed out/iu.test(detail)) {
    return browserFailure(
      `Could not click element '${elementId}': it did not become actionable before the timeout`,
      'BROWSER_CLICK_TIMEOUT',
      error,
    )
  }
  if (/intercepts pointer events|not visible|not enabled|outside of the viewport|not stable/iu.test(detail)) {
    return browserFailure(
      `Could not click element '${elementId}': the element is not actionable`,
      'BROWSER_CLICK_NOT_ACTIONABLE',
      error,
    )
  }
  return browserFailure(`Could not click element '${elementId}'`, 'BROWSER_CLICK_FAILED', error)
}

function normalizeCookie(cookie: BrowserCookieInput, index: number): BrowserCookieInput & { path: string } {
  const invalid = (): never => { throw browserFailure(`Cookie at index ${String(index)} is invalid`, 'BROWSER_REQUEST_INVALID') }
  if (!/^[!#$%&'*+\-.^_`|~A-Za-z0-9]+$/.test(cookie.name) || cookie.name.length > 256
    || !/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/.test(cookie.value) || cookie.value.length > 4096) invalid()
  const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain
  if (domain.length === 0 || domain.length > 253 || !domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) invalid()
  const path = cookie.path ?? '/'
  if (!path.startsWith('/') || path.length > 1024 || /[\x00-\x1f\x7f;]/.test(path)) invalid()
  if (cookie.expires !== undefined && (!Number.isFinite(cookie.expires) || cookie.expires < -1)) invalid()
  if (cookie.sameSite === 'None' && cookie.secure !== true) invalid()
  if (cookie.name.startsWith('__Secure-') && cookie.secure !== true) invalid()
  if (cookie.name.startsWith('__Host-') && (cookie.secure !== true || path !== '/' || cookie.domain.startsWith('.'))) invalid()
  return { name: cookie.name, value: cookie.value, domain: cookie.domain, path,
    ...(cookie.expires === undefined ? {} : { expires: cookie.expires }),
    ...(cookie.secure === undefined ? {} : { secure: cookie.secure }),
    ...(cookie.httpOnly === undefined ? {} : { httpOnly: cookie.httpOnly }),
    ...(cookie.sameSite === undefined ? {} : { sameSite: cookie.sameSite }),
  }
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().slice(0, 2048)
  } catch { return 'about:blank' }
}

async function pageMetadata(page: Page, pageId: ReturnType<typeof BrowserPageId>, index: number, active: boolean): Promise<BrowserPage> {
  return { pageId, index, url: page.url(), title: await page.title(), active }
}

function readElementFingerprint(node: Element): ElementFingerprint {
  const tagName = node.tagName.toLowerCase()
  const role = node.getAttribute('role') ?? tagName
  const name = node.getAttribute('aria-label')
    ?? node.getAttribute('title')
    ?? node.textContent.trim().slice(0, 200)
  return { tagName, role, name, text: node.textContent.trim().slice(0, 500) }
}

function sameFingerprint(left: ElementFingerprint, right: ElementFingerprint): boolean {
  return left.tagName === right.tagName
    && left.role === right.role
    && left.name === right.name
    && left.text === right.text
}

function captureRect(
  box: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  maxPixels: number,
): BrowserRect {
  const values = [box.x, box.y, box.width, box.height, viewport.width, viewport.height]
  if (values.some(value => !Number.isFinite(value)) || box.width <= 0 || box.height <= 0) {
    throw browserFailure('browser element has no finite visible bounds', 'BROWSER_ELEMENT_CAPTURE_BOUNDS')
  }
  const x = Math.max(0, box.x)
  const y = Math.max(0, box.y)
  const right = Math.min(viewport.width, box.x + box.width)
  const bottom = Math.min(viewport.height, box.y + box.height)
  const width = right - x
  const height = bottom - y
  if (width <= 0 || height <= 0 || width * height > maxPixels) {
    throw browserFailure('browser element bounds are outside the viewport or exceed the capture pixel limit', 'BROWSER_ELEMENT_CAPTURE_BOUNDS')
  }
  return { x, y, width, height }
}

function sameRect(left: BrowserRect, right: BrowserRect): boolean {
  return Math.abs(left.x - right.x) <= 0.5
    && Math.abs(left.y - right.y) <= 0.5
    && Math.abs(left.width - right.width) <= 0.5
    && Math.abs(left.height - right.height) <= 0.5
}

function captureFailure(error: unknown): BrowserError {
  if (error instanceof BrowserError) return error
  const detail = error instanceof Error ? error.message : String(error)
  if (/detached|not attached|no longer.*dom|stale/iu.test(detail)) {
    return browserFailure('browser element changed or became detached during capture; take a new snapshot', 'BROWSER_ELEMENT_STALE', error)
  }
  return browserFailure(`Could not capture browser element: ${detail}`, 'BROWSER_ELEMENT_CAPTURE_FAILED', error)
}

/** Playwright implementation of persistent Browser capability operations. */
export class PlaywrightBrowserProvider implements BrowserElementCaptureProvider, BrowserAutomationProvider, BrowserTransferProvider {
  readonly id: string

  private readonly pageIds = new Map<Page, ReturnType<typeof BrowserPageId>>()
  private readonly pages = new Map<ReturnType<typeof BrowserPageId>, Page>()
  private readonly observations = new Map<ReturnType<typeof BrowserPageId>, ObservationState>()
  private readonly selections = new Map<ReturnType<typeof BrowserElementSelectionId>, SelectionState>()
  private readonly pageLifecycles = new Map<ReturnType<typeof BrowserPageId>, AbortController>()
  private readonly historyByPage = new Map<ReturnType<typeof BrowserPageId>, BrowserHistoryEntry[]>()
  private readonly networkByPage = new Map<ReturnType<typeof BrowserPageId>, BrowserNetworkEntry[]>()
  private readonly downloadsByPage = new Map<ReturnType<typeof BrowserPageId>, Map<BrowserDownloadId, { readonly download: Download; status: BrowserDownload['status'] }>>()
  private readonly pendingNetwork = new WeakMap<PlaywrightRequest, BrowserNetworkEntry>()
  private readonly truncatedDownloads = new Set<ReturnType<typeof BrowserPageId>>()
  private readonly downloadSettlements = new Set<Promise<void>>()
  private readonly closingPages = new Set<ReturnType<typeof BrowserPageId>>()
  private readonly lifecycle = new AbortController()
  private contextPromise: Promise<BrowserContext> | undefined
  private disposed = false

  /**
   * @param config - fully validated provider settings.
   * @param launch - Playwright context launcher; injectable for deterministic tests.
   */
  constructor(
    private readonly config: ResolvedConfig,
    private readonly launch: ContextLauncher = (userDataDir, options) => chromium.launchPersistentContext(userDataDir, options),
  ) {
    this.id = config.providerId
  }

  /** @inheritdoc */
  currentProfile(): string { return this.config.profileName }

  /** @inheritdoc */
  resolveNavigation(target: BrowserNavigationTarget): BrowserOpenRequest {
    switch (target.kind) {
      case 'home': return { url: this.config.homePage }
      case 'url': return { url: browserUrl('url', target.url) }
      case 'search': {
        const query = cleanString('query', target.query)
        if (query.length > 500) throw browserFailure('browser search query exceeds 500 characters', 'BROWSER_REQUEST_INVALID')
        const origins = { google: 'https://www.google.com/search', bing: 'https://www.bing.com/search', duckduckgo: 'https://duckduckgo.com/' }
        const url = new URL(origins[this.config.searchEngine])
        url.searchParams.set('q', query)
        return { url: url.href }
      }
      default: return assertNever(target, 'browser navigation')
    }
  }

  /** @returns Whether this provider accepts new operations. */
  available(): boolean {
    return !this.disposed
  }

  private boundSignal(signal?: AbortSignal): AbortSignal {
    return signal === undefined ? this.lifecycle.signal : AbortSignal.any([signal, this.lifecycle.signal])
  }

  private async bounded<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.boundedWithSignal(operation, this.boundSignal(signal))
  }

  /** Race one Playwright promise against a pre-composed cancellation signal. */
  private async boundedWithSignal<T>(operation: Promise<T>, bound: AbortSignal): Promise<T> {
    bound.throwIfAborted()
    let rejectAbort!: (reason?: unknown) => void
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = reject
    })
    const onAbort = () => { rejectAbort(bound.reason) }
    bound.addEventListener('abort', onAbort, { once: true })
    try {
      return await Promise.race([operation, aborted])
    } finally {
      bound.removeEventListener('abort', onAbort)
    }
  }

  /** Combine caller, provider, and page lifecycle cancellation for one operation. */
  private pageSignal(pageId: ReturnType<typeof BrowserPageId>, signal?: AbortSignal): AbortSignal {
    const lifecycle = this.pageLifecycles.get(pageId)
    return lifecycle === undefined
      ? this.boundSignal(signal)
      : AbortSignal.any([this.boundSignal(signal), lifecycle.signal])
  }

  /** Await a page operation while observing external page closure. */
  private async boundedPage<T>(pageId: ReturnType<typeof BrowserPageId>, operation: Promise<T>, signal?: AbortSignal): Promise<T> {
    return this.boundedWithSignal(operation, this.pageSignal(pageId, signal))
  }

  private async context(signal?: AbortSignal): Promise<BrowserContext> {
    if (this.disposed) throw browserFailure('Playwright browser provider is disposed', 'BROWSER_PROVIDER_DISPOSED')
    if (this.contextPromise === undefined) {
      const launchOptions: NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]> = {
        env: scrubbedParentEnv(),
        headless: this.config.headless,
        timeout: this.config.actionTimeoutMs,
        viewport: { width: this.config.viewportWidth, height: this.config.viewportHeight },
        ...(this.config.executablePath === undefined
          ? { channel: this.config.browserChannel }
          : { executablePath: this.config.executablePath }),
      }
      const storageDir = this.config.profileName === 'default'
        ? this.config.storageDir
        : join(this.config.storageDir, 'harness-profiles', 'profile-' + this.config.profileName)
      this.contextPromise = this.launch(storageDir, launchOptions).then((context) => {
        context.setDefaultTimeout(this.config.actionTimeoutMs)
        context.setDefaultNavigationTimeout(this.config.navigationTimeoutMs)
        for (const page of context.pages()) this.trackPage(page)
        context.on('page', (page) => { this.trackPage(page) })
        return context
      }).catch((error: unknown) => {
        this.contextPromise = undefined
        throw browserFailure(
          `Could not start the Harness browser using ${this.config.executablePath ?? this.config.browserChannel}`,
          'BROWSER_PLAYWRIGHT_LAUNCH_FAILED',
          error,
        )
      })
    }
    return this.bounded(this.contextPromise, signal)
  }

  private trackPage(page: Page): ReturnType<typeof BrowserPageId> {
    const known = this.pageIds.get(page)
    if (known !== undefined) return known
    const pageId = BrowserPageId(randomUUID())
    this.pageIds.set(page, pageId)
    this.pages.set(pageId, page)
    this.pageLifecycles.set(pageId, new AbortController())
    this.historyByPage.set(pageId, [])
    this.networkByPage.set(pageId, [])
    this.downloadsByPage.set(pageId, new Map())
    page.on('download', (download) => {
      const downloads = this.downloadsByPage.get(pageId)
      if (downloads === undefined || this.disposed || downloads.size >= this.config.maxDownloadCount) {
        this.truncatedDownloads.add(pageId)
        this.trackDownloadSettlement(download.cancel().catch(() => { /* A failed transfer is already stopped. */ }))
        return
      }
      const id = randomUUID() as BrowserDownloadId
      const record: { download: Download; status: BrowserDownload['status'] } = { download, status: 'in-progress' }
      downloads.set(id, record)
      this.trackDownloadSettlement(download.failure().then((failure) => { record.status = failure === null ? 'complete' : 'failed' }, () => { record.status = 'failed' }))
    })
    page.on('request', (request) => {
      const entry: BrowserNetworkEntry = {
        url: safeUrl(request.url()), method: request.method(), resourceType: request.resourceType(), at: Date.now(),
      }
      this.pendingNetwork.set(request, entry)
      this.recordNetwork(pageId, entry)
    })
    page.on('response', (response) => {
      this.updateNetwork(pageId, response.request(), { status: response.status() })
    })
    page.on('requestfailed', (request) => {
      this.updateNetwork(pageId, request, { failed: 'request-failed' })
      this.pendingNetwork.delete(request)
    })
    page.on('requestfinished', (request) => { this.pendingNetwork.delete(request) })
    page.on('close', () => {
      this.pageIds.delete(page)
      this.pages.delete(pageId)
      if (!this.closingPages.has(pageId)) {
        this.pageLifecycles.get(pageId)?.abort(
          browserFailure(`browser page '${pageId}' was closed`, 'BROWSER_PAGE_CLOSED'),
        )
      }
      this.pageLifecycles.delete(pageId)
      this.historyByPage.delete(pageId)
      this.networkByPage.delete(pageId)
      const downloads = this.downloadsByPage.get(pageId)
      for (const record of downloads?.values() ?? []) {
        this.trackDownloadSettlement(record.download.cancel().catch(() => { /* Completed transfers need no cancellation. */ }))
      }
      this.downloadsByPage.delete(pageId)
      this.truncatedDownloads.delete(pageId)
      void this.invalidate(pageId)
    })
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        void this.invalidate(pageId)
        this.recordHistory(pageId, page.url(), '')
      }
    })
    return pageId
  }

  private recordNetwork(pageId: ReturnType<typeof BrowserPageId>, entry: BrowserNetworkEntry): void {
    const entries = this.networkByPage.get(pageId)
    if (entries === undefined) return
    entries.push(entry)
    if (entries.length > this.config.maxNetworkEntries) entries.splice(0, entries.length - this.config.maxNetworkEntries)
  }

  private updateNetwork(pageId: ReturnType<typeof BrowserPageId>, request: PlaywrightRequest, patch: Partial<BrowserNetworkEntry>): void {
    const entry = this.pendingNetwork.get(request)
    const entries = this.networkByPage.get(pageId)
    if (entry === undefined || entries === undefined) return
    const index = entries.indexOf(entry)
    if (index >= 0) {
      const next = { ...entry, ...patch }
      entries[index] = next
      this.pendingNetwork.set(request, next)
    }
  }

  private recordHistory(pageId: ReturnType<typeof BrowserPageId>, value: string, title: string): void {
    const entries = this.historyByPage.get(pageId)
    if (entries === undefined) return
    const url = safeUrl(value)
    const last = entries.at(-1)
    if (last?.url === url) {
      if (title.length > 0) entries[entries.length - 1] = { ...last, title: title.slice(0, 500) }
      return
    }
    entries.push({ url, title: title.slice(0, 500), at: Date.now() })
    if (entries.length > this.config.maxHistoryEntries) entries.splice(0, entries.length - this.config.maxHistoryEntries)
  }

  private page(pageId: ReturnType<typeof BrowserPageId>): Page {
    const page = this.pages.get(pageId)
    if (page === undefined || page.isClosed()) {
      throw browserFailure(`browser page '${pageId}' does not exist`, 'BROWSER_PAGE_NOT_FOUND')
    }
    return page
  }

  private async invalidate(pageId: ReturnType<typeof BrowserPageId>): Promise<void> {
    const observation = this.observations.get(pageId)
    this.observations.delete(pageId)
    const selections = [...this.selections].filter(([, selection]) => selection.pageId === pageId)
    for (const [selectionId] of selections) this.selections.delete(selectionId)
    await Promise.allSettled([
      ...(observation === undefined ? [] : [...observation.elements.values()].map(element => element.dispose())),
      ...selections.map(([, selection]) => selection.handle.dispose()),
    ])
  }

  /** @inheritdoc */
  async listPages(signal?: AbortSignal): Promise<readonly BrowserPage[]> {
    const context = await this.context(signal)
    const pages = context.pages()
    return Promise.all(pages.map(async (page, index) => {
      const id = this.trackPage(page)
      return pageMetadata(page, id, index, index === pages.length - 1)
    }))
  }

  /** @inheritdoc */
  async openPage(request: BrowserOpenRequest, signal?: AbortSignal): Promise<BrowserOpenResult> {
    this.boundSignal(signal).throwIfAborted()
    browserUrl('url', request.url)
    const context = await this.context(signal)
    this.boundSignal(signal).throwIfAborted()
    const creation = context.newPage()
    let page: Page
    try {
      page = await this.bounded(creation, signal)
      const pageId = this.trackPage(page)
      await this.boundedPage(pageId, page.goto(request.url, { waitUntil: 'domcontentloaded' }), signal)
      this.recordHistory(pageId, page.url(), await this.boundedPage(pageId, page.title(), signal))
      return { pageId }
    } catch (error) {
      void creation.then(created => created.close()).catch(() => {})
      if (error instanceof BrowserError) throw error
      if (this.boundSignal(signal).aborted) throw error
      throw browserFailure(`Could not open ${request.url}`, 'BROWSER_NAVIGATION_FAILED', error)
    }
  }

  /** @inheritdoc */
  async navigate(request: BrowserNavigateRequest, signal?: AbortSignal): Promise<BrowserNavigateResult> {
    this.boundSignal(signal).throwIfAborted()
    browserUrl('url', request.url)
    const page = this.page(request.pageId)
    await this.invalidate(request.pageId)
    try {
      this.pageSignal(request.pageId, signal).throwIfAborted()
      await this.boundedPage(request.pageId, page.goto(request.url, { waitUntil: 'domcontentloaded' }), signal)
      this.recordHistory(request.pageId, page.url(), await this.boundedPage(request.pageId, page.title(), signal))
      return { pageId: request.pageId, url: page.url(), title: await page.title() }
    } catch (error) {
      if (error instanceof BrowserError) throw error
      if (this.boundSignal(signal).aborted) throw error
      throw browserFailure(`Could not navigate browser page '${request.pageId}'`, 'BROWSER_NAVIGATION_FAILED', error)
    }
  }

  /** @inheritdoc */
  async snapshot(request: BrowserSnapshotRequest, signal?: AbortSignal): Promise<BrowserObservation> {
    const page = this.page(request.pageId)
    await this.invalidate(request.pageId)
    const body = page.locator('body')
    const tree = await this.boundedPage(request.pageId, body.ariaSnapshot(), signal).catch((error: unknown) => {
      if (error instanceof BrowserError) throw error
      throw browserFailure(`Could not inspect browser page '${request.pageId}'`, 'BROWSER_SNAPSHOT_FAILED', error)
    })
    const candidates = page.locator(INTERACTIVE_SELECTOR)
    const count = Math.min(await this.boundedPage(request.pageId, candidates.count(), signal), this.config.maxElements)
    const elements = new Map<ReturnType<typeof BrowserElementId>, ElementHandle>()
    const fingerprints = new Map<ReturnType<typeof BrowserElementId>, ElementFingerprint>()
    const values: BrowserElement[] = []
    for (let index = 0; index < count; index += 1) {
      const locator = candidates.nth(index)
      if (!await this.boundedPage(request.pageId, locator.isVisible(), signal).catch(() => false)) continue
      const handle = await this.boundedPage(request.pageId, locator.elementHandle(), signal)
      if (handle === null) continue
      const elementId = BrowserElementId(`e${values.length + 1}`)
      const tag = await this.boundedPage(request.pageId, locator.evaluate(node => node.tagName.toLowerCase()), signal)
      const role = await this.boundedPage(request.pageId, locator.getAttribute('role'), signal) ?? tag
      const text = (await this.boundedPage(request.pageId, locator.textContent(), signal) ?? '').trim().slice(0, 500)
      const name = await this.boundedPage(request.pageId, locator.getAttribute('aria-label'), signal)
        ?? await this.boundedPage(request.pageId, locator.getAttribute('title'), signal)
        ?? text.slice(0, 200)
      elements.set(elementId, handle)
      fingerprints.set(elementId, { tagName: tag, role, name, text })
      values.push({ elementId, role, name })
    }
    const observationId = BrowserObservationId(randomUUID())
    this.observations.set(request.pageId, { id: observationId, elements, fingerprints })
    const references = values.map(value => `${value.role} ${JSON.stringify(value.name)} [ref=${value.elementId}]`).join('\n')
    return {
      observationId,
      pageId: request.pageId,
      url: page.url(),
      title: await page.title(),
      tree: references.length === 0 ? tree : `${tree}\n\nInteractive element references:\n${references}`,
      elements: values,
    }
  }

  /** @inheritdoc */
  async click(request: BrowserClickRequest, signal?: AbortSignal): Promise<BrowserClickResult> {
    this.page(request.pageId)
    const observation = this.observations.get(request.pageId)
    if (observation?.id !== request.observationId) {
      throw browserFailure('browser observation is stale; take a new snapshot', 'BROWSER_OBSERVATION_STALE')
    }
    const element = observation.elements.get(request.elementId)
    if (element === undefined) {
      throw browserFailure(`element '${request.elementId}' is not in the current observation`, 'BROWSER_ELEMENT_STALE')
    }
    this.observations.delete(request.pageId)
    try {
      await this.boundedPage(request.pageId, element.click(), signal)
      return { pageId: request.pageId, observationId: request.observationId, elementId: request.elementId }
    } catch (error) {
      if (error instanceof BrowserError) throw error
      throw clickFailure(request.elementId, error)
    } finally {
      await Promise.allSettled([...observation.elements.values()].map(handle => handle.dispose()))
    }
  }

  private async fingerprint(
    handle: ElementHandle,
    pageId: ReturnType<typeof BrowserPageId>,
    signal?: AbortSignal,
  ): Promise<ElementFingerprint> {
    try {
      return await this.boundedPage(pageId, handle.evaluate(readElementFingerprint), signal)
    } catch (error) {
      throw captureFailure(error)
    }
  }

  private async viewport(
    pageId: ReturnType<typeof BrowserPageId>,
    page: Page,
    signal?: AbortSignal,
  ): Promise<{ width: number; height: number }> {
    try {
      return await this.boundedPage(pageId, page.evaluate(() => ({ width: innerWidth, height: innerHeight })), signal)
    } catch (error) {
      throw captureFailure(error)
    }
  }

  /** @inheritdoc */
  async selectElement(request: BrowserElementSelectionRequest, signal?: AbortSignal): Promise<BrowserElementSelection> {
    const page = this.page(request.pageId)
    const key = 'dsh-' + randomUUID()
    const timeout = AbortSignal.timeout(this.config.selectionTimeoutMs)
    const pageSignal = this.pageSignal(request.pageId, signal)
    const bound = AbortSignal.any([pageSignal, timeout])
    let raw: RawOverlaySelection | null
    try {
      raw = await this.boundedWithSignal(page.evaluate(selectElementInPage, key), bound)
    } catch (error) {
      if (pageSignal.aborted) throw pageSignal.reason
      if (timeout.aborted) {
        throw browserFailure('browser element selection timed out; select an element before the deadline', 'BROWSER_SELECTION_TIMEOUT', error)
      }
      throw captureFailure(error)
    } finally {
      await this.bounded(page.evaluate(clearElementOverlay, key)).catch(() => {})
    }
    if (raw === null) throw browserFailure('browser element selection was cancelled', 'BROWSER_SELECTION_CANCELLED')

    let handle: ElementHandle | null = null
    let markerRemoved = false
    try {
      const viewport = await this.viewport(request.pageId, page, signal)
      const rect = captureRect(raw.rect, viewport, this.config.maxCapturePixels)
      const locator = page.locator('[data-dsh-browser-element="' + raw.key + '"]')
      const count = await this.boundedPage(request.pageId, locator.count(), signal)
      if (count !== 1) throw browserFailure('selected browser element is no longer available', 'BROWSER_ELEMENT_STALE')
      handle = await this.boundedPage(request.pageId, locator.elementHandle(), signal)
      if (handle === null) throw browserFailure('selected browser element is no longer available', 'BROWSER_ELEMENT_STALE')
      await this.boundedPage(request.pageId, page.evaluate(removeSelectionMarker, raw.key), signal)
      markerRemoved = true
      const fingerprint = await this.fingerprint(handle, request.pageId, signal)
      const selectionId = BrowserElementSelectionId(randomUUID())
      this.selections.set(selectionId, { pageId: request.pageId, handle, fingerprint })
      return { selectionId, pageId: request.pageId, ...fingerprint, rect }
    } catch (error) {
      await handle?.dispose()
      if (pageSignal.aborted) throw pageSignal.reason
      throw captureFailure(error)
    } finally {
      if (!markerRemoved) {
        await this.bounded(page.evaluate(removeSelectionMarker, raw.key)).catch(() => {})
      }
    }
  }
  /** @inheritdoc */
  async captureElement(request: BrowserElementCaptureRequest, signal?: AbortSignal): Promise<BrowserElementScreenshot> {
    const page = this.page(request.pageId)
    const pageSignal = this.pageSignal(request.pageId, signal)
    let handle: ElementHandle | undefined
    let expected: ElementFingerprint | undefined
    let selectionId: ReturnType<typeof BrowserElementSelectionId> | undefined
    if (request.target.kind === 'observation') {
      const observation = this.observations.get(request.pageId)
      if (observation === undefined || observation.id !== request.target.observationId) {
        throw browserFailure('browser observation is stale; take a new snapshot', 'BROWSER_OBSERVATION_STALE')
      }
      handle = observation.elements.get(request.target.elementId)
      expected = observation.fingerprints.get(request.target.elementId)
      if (handle === undefined || expected === undefined) {
        throw browserFailure('element ' + request.target.elementId + ' is not in the current observation', 'BROWSER_ELEMENT_STALE')
      }
    } else {
      selectionId = request.target.selectionId
      const selection = this.selections.get(request.target.selectionId)
      if (selection === undefined || selection.pageId !== request.pageId) {
        throw browserFailure('browser element selection is stale; select the element again', 'BROWSER_ELEMENT_STALE')
      }
      handle = selection.handle
      expected = selection.fingerprint
    }
    try {
      const viewport = await this.viewport(request.pageId, page, signal)
      const before = await this.fingerprint(handle, request.pageId, signal)
      if (!sameFingerprint(expected, before)) {
        throw browserFailure('browser element changed after selection; select it again', 'BROWSER_ELEMENT_CHANGED')
      }
      const firstBox = await this.boundedPage(request.pageId, handle.boundingBox(), signal)
      if (firstBox === null) throw browserFailure('browser element is not visible', 'BROWSER_ELEMENT_CAPTURE_BOUNDS')
      const rect = captureRect(firstBox, viewport, this.config.maxCapturePixels)
      const bytes = await this.boundedPage(request.pageId, page.screenshot({ type: request.format, clip: rect }), signal)
      const data = new Uint8Array(bytes)
      if (data.byteLength > this.config.maxCaptureBytes) {
        throw browserFailure(`browser element screenshot exceeds the configured ${this.config.maxCaptureBytes}-byte limit`, 'BROWSER_ELEMENT_CAPTURE_TOO_LARGE')
      }
      const after = await this.fingerprint(handle, request.pageId, signal)
      const secondBox = await this.boundedPage(request.pageId, handle.boundingBox(), signal)
      if (secondBox === null) throw browserFailure('browser element became invisible during capture', 'BROWSER_ELEMENT_CHANGED')
      const secondRect = captureRect(secondBox, viewport, this.config.maxCapturePixels)
      if (!sameFingerprint(before, after) || !sameRect(rect, secondRect)) {
        throw browserFailure('browser element changed during capture; take a new snapshot', 'BROWSER_ELEMENT_CHANGED')
      }
      return {
        pageId: request.pageId,
        format: request.format,
        mediaType: request.format === 'png' ? 'image/png' : 'image/jpeg',
        data,
        target: request.target,
        rect: secondRect,
        viewport,
        verified: true,
        tagName: after.tagName,
        role: after.role,
        name: after.name,
      }
    } catch (error) {
      if (pageSignal.aborted) throw pageSignal.reason
      throw captureFailure(error)
    } finally {
      if (selectionId !== undefined) {
        const selected = this.selections.get(selectionId)
        this.selections.delete(selectionId)
        await selected?.handle.dispose()
      }
    }
  }

  /** Return bounded navigation history, newest entry last. */
  async history(pageId: ReturnType<typeof BrowserPageId>, limit: number, signal?: AbortSignal): Promise<readonly BrowserHistoryEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw browserFailure('browser history limit must be between 1 and 100', 'BROWSER_REQUEST_INVALID')
    this.boundSignal(signal).throwIfAborted()
    const page = this.page(pageId)
    this.recordHistory(pageId, page.url(), await this.boundedPage(pageId, page.title(), signal))
    return (this.historyByPage.get(pageId) ?? []).slice(-limit).map(entry => ({ ...entry }))
  }

  private async traverse(pageId: ReturnType<typeof BrowserPageId>, direction: 'back' | 'forward', signal?: AbortSignal): Promise<BrowserNavigateResult> {
    this.boundSignal(signal).throwIfAborted()
    const page = this.page(pageId)
    await this.invalidate(pageId)
    this.pageSignal(pageId, signal).throwIfAborted()
    const promise = direction === 'back' ? page.goBack({ waitUntil: 'domcontentloaded' }) : page.goForward({ waitUntil: 'domcontentloaded' })
    try {
      await this.boundedPage(pageId, promise, signal)
      this.recordHistory(pageId, page.url(), await this.boundedPage(pageId, page.title(), signal))
      return { pageId, url: page.url(), title: await page.title() }
    } catch (error) {
      if (error instanceof BrowserError) throw error
      throw browserFailure(`Could not traverse browser page '${pageId}'`, 'BROWSER_NAVIGATION_FAILED', error)
    }
  }

  /** Navigate one step backward in the browser history. */
  async back(pageId: ReturnType<typeof BrowserPageId>, signal?: AbortSignal): Promise<BrowserNavigateResult> { return this.traverse(pageId, 'back', signal) }

  /** Navigate one step forward in the browser history. */
  async forward(pageId: ReturnType<typeof BrowserPageId>, signal?: AbortSignal): Promise<BrowserNavigateResult> { return this.traverse(pageId, 'forward', signal) }

  /** Return recent request/response observations for one page. */
  // oxlint-disable-next-line typescript/require-await -- admission failures follow the asynchronous Provider protocol.
  async network(pageId: ReturnType<typeof BrowserPageId>, limit: number, signal?: AbortSignal): Promise<readonly BrowserNetworkEntry[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw browserFailure('browser network limit must be between 1 and 100', 'BROWSER_REQUEST_INVALID')
    this.page(pageId)
    this.boundSignal(signal).throwIfAborted()
    return (this.networkByPage.get(pageId) ?? []).slice(-limit).map(entry => ({ ...entry }))
  }

  /** @inheritdoc */
  async importCookies(request: BrowserCookieImportRequest, signal?: AbortSignal): Promise<{ readonly imported: number }> {
    this.boundSignal(signal).throwIfAborted()
    if (request.profileName !== this.config.profileName) throw browserFailure('The active browser profile changed; refresh before importing cookies', 'BROWSER_PROFILE_MISMATCH')
    if (request.cookies.length > this.config.maxCookieCount) throw browserFailure('Cookie import exceeds the configured count limit', 'BROWSER_REQUEST_INVALID')
    const normalized = request.cookies.map(normalizeCookie)
    const context = await this.context(signal)
    this.boundSignal(signal).throwIfAborted()
    try { await this.bounded(context.addCookies(normalized), signal) } catch (_cookieImportFailure) {
      this.boundSignal(signal).throwIfAborted()
      throw browserFailure('The browser rejected the cookie import', 'BROWSER_COOKIE_IMPORT_FAILED')
    }
    return { imported: normalized.length }
  }

  private trackDownloadSettlement(promise: Promise<void>): void {
    this.downloadSettlements.add(promise)
    void promise.finally(() => { this.downloadSettlements.delete(promise) })
  }

  /** @inheritdoc */
  async upload(request: BrowserUploadRequest, signal?: AbortSignal): Promise<void> {
    this.boundSignal(signal).throwIfAborted()
    assertUploadName(request.name)
    if (request.data.byteLength > this.config.maxTransferBytes) throw browserFailure('Upload exceeds the configured byte limit', 'BROWSER_TRANSFER_TOO_LARGE')
    this.page(request.pageId)
    const observation = this.observations.get(request.pageId)
    if (observation?.id !== request.observationId) throw browserFailure('Browser observation is stale', 'BROWSER_OBSERVATION_STALE')
    const element = observation.elements.get(request.elementId)
    const expected = observation.fingerprints.get(request.elementId)
    if (element === undefined || expected === undefined) throw browserFailure('File input is absent from observation', 'BROWSER_ELEMENT_STALE')
    this.observations.delete(request.pageId)
    try {
      const current = await this.fingerprint(element, request.pageId, signal)
      if (!sameFingerprint(expected, current)) throw browserFailure('File input changed since observation', 'BROWSER_ELEMENT_CHANGED')
      this.boundSignal(signal).throwIfAborted()
      await this.boundedPage(request.pageId, element.setInputFiles({ name: request.name, mimeType: 'application/octet-stream', buffer: Buffer.from(request.data) }), signal)
    } catch (error) {
      if (error instanceof BrowserError) throw error
      this.boundSignal(signal).throwIfAborted()
      throw browserFailure('Could not set browser file input', 'BROWSER_UPLOAD_FAILED')
    } finally { await Promise.allSettled([...observation.elements.values()].map(handle => handle.dispose())) }
  }

  /** @inheritdoc */
  async downloads(
    pageId: ReturnType<typeof BrowserPageId>, signal?: AbortSignal,
  ): Promise<{ readonly items: readonly BrowserDownload[]; readonly truncated: boolean }> {
    this.boundSignal(signal).throwIfAborted()
    const page = this.page(pageId)
    await this.boundedPage(pageId, page.title(), signal)
    const items = [...(this.downloadsByPage.get(pageId)?.entries() ?? [])].map(([id, record]) => ({
      id, pageId, name: downloadName(record.download.suggestedFilename()), status: record.status,
    }))
    return { items, truncated: this.truncatedDownloads.has(pageId) }
  }

  /** @inheritdoc */
  async readDownload(
    pageId: ReturnType<typeof BrowserPageId>, downloadId: BrowserDownloadId, maxBytes: number, signal?: AbortSignal,
  ): Promise<BrowserDownloadedFile> {
    positiveInteger('maxBytes', maxBytes)
    this.boundSignal(signal).throwIfAborted()
    this.page(pageId)
    const record = this.downloadsByPage.get(pageId)?.get(downloadId)
    if (record === undefined) throw browserFailure('Download not found for this page', 'BROWSER_DOWNLOAD_NOT_FOUND')
    if (record.status !== 'complete') throw browserFailure('Download is not complete', 'BROWSER_DOWNLOAD_PENDING')
    try {
      const data = await downloadBytes(record.download, Math.min(maxBytes, this.config.maxTransferBytes), this.pageSignal(pageId, signal))
      return { name: downloadName(record.download.suggestedFilename()), data }
    } catch (error) {
      if (error instanceof BrowserError) throw error
      this.boundSignal(signal).throwIfAborted()
      throw browserFailure('Download data is unavailable', 'BROWSER_DOWNLOAD_FAILED')
    }
  }

  /** @inheritdoc */
  async screenshot(request: BrowserScreenshotRequest, signal?: AbortSignal): Promise<BrowserScreenshot> {
    const page = this.page(request.pageId)
    try {
      const data = await this.boundedPage(request.pageId, page.screenshot({ type: request.format }), signal)
      return {
        pageId: request.pageId,
        format: request.format,
        mediaType: request.format === 'png' ? 'image/png' : 'image/jpeg',
        data: new Uint8Array(data),
      }
    } catch (error) {
      if (error instanceof BrowserError) throw error
      throw browserFailure(`Could not capture browser page '${request.pageId}'`, 'BROWSER_SCREENSHOT_FAILED', error)
    }
  }

  /** @inheritdoc */
  async closePage(request: BrowserCloseRequest, signal?: AbortSignal): Promise<void> {
    this.boundSignal(signal).throwIfAborted()
    const page = this.page(request.pageId)
    const lifetime = this.pageLifecycles.get(request.pageId)
    await this.invalidate(request.pageId)
    this.closingPages.add(request.pageId)
    try {
      await this.boundedPage(request.pageId, page.close(), signal)
    } catch (error) {
      throw browserFailure(`Could not close browser page '${request.pageId}'`, 'BROWSER_CLOSE_FAILED', error)
    } finally {
      this.closingPages.delete(request.pageId)
      if (!this.pages.has(request.pageId)) lifetime?.abort(browserFailure('Browser page closed', 'BROWSER_PAGE_CLOSED'))
    }
  }

  /** Close the persistent context and reject new operations. */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.lifecycle.abort(browserFailure('Playwright browser provider is disposed', 'BROWSER_PROVIDER_DISPOSED'))
    await Promise.allSettled([...this.pages.keys()].map(pageId => this.invalidate(pageId)))
    const context = await this.contextPromise?.catch(() => undefined)
    if (context !== undefined) await context.close()
    await Promise.allSettled([...this.downloadSettlements])
    this.downloadsByPage.clear()
    this.truncatedDownloads.clear()
    this.pages.clear()
    this.pageIds.clear()
    this.pageLifecycles.clear()
    this.historyByPage.clear()
    this.networkByPage.clear()
    this.closingPages.clear()
  }
}

/**
 * Register the Harness-owned Playwright provider.
 * @param ctx - context carrying the Browser Service Definition.
 * @param config - Playwright provider settings.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const base = resolvePlaywrightBrowserConfig(config)
  const preferences = ctx.settings.register('browser-playwright', BrowserPreferencesSchema, {
    base: {
      browserChannel: base.browserChannel, headless: base.headless,
      viewportWidth: base.viewportWidth, viewportHeight: base.viewportHeight,
      profileName: base.profileName, homePage: base.homePage, searchEngine: base.searchEngine,
    },
    applies: 'restart',
    validate: (value) => {
      if (Object.keys(value).some(key => !PREFERENCE_KEYS.has(key))) throw new Error('browser-playwright: unsupported preference field')
      profileName(value.profileName)
      browserUrl('homePage', value.homePage)
    },
  })
  const saved = preferences.get()
  const provider = new PlaywrightBrowserProvider({
    ...base, browserChannel: saved.browserChannel, headless: saved.headless,
    viewportWidth: saved.viewportWidth, viewportHeight: saved.viewportHeight,
    homePage: saved.homePage, searchEngine: saved.searchEngine,
    profileName: profileName(saved.profileName),
  })
  ctx.effect(function* () {
    const unregister = ctx.browser.registerProvider(provider)
    yield async () => {
      unregister()
      await provider.dispose()
    }
  }, 'browser-playwright.lifecycle')
}
