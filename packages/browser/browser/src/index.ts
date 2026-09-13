/**
 * Provider-neutral Service Definition for persistent browser tabs. Providers
 * own browser transport and short-lived observation state; Consumers own tool
 * schemas, permission decisions, attachment persistence, and presentation.
 * OS-level Computer Use is a separate capability.
 * @module @deepseek-ai/dsh-browser
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type {
  BrowserAutomationProvider,
  BrowserTransferProvider,
  BrowserDownload,
  BrowserDownloadId,
  BrowserDownloadedFile,
  BrowserUploadRequest,
  BrowserClickRequest,
  BrowserClickResult,
  BrowserCloseRequest,
  BrowserCookieImportRequest,
  BrowserNavigationTarget,
  BrowserElementCaptureProvider,
  BrowserElementCaptureRequest,
  BrowserElementId as BrowserElementIdValue,
  BrowserElementScreenshot,
  BrowserElementSelection,
  BrowserElementSelectionId as BrowserElementSelectionIdValue,
  BrowserElementSelectionRequest,
  BrowserHistoryEntry,
  BrowserNavigateRequest,
  BrowserNavigateResult,
  BrowserNetworkEntry,
  BrowserObservation,
  BrowserObservationId as BrowserObservationIdValue,
  BrowserOpenRequest,
  BrowserOpenResult,
  BrowserPage,
  BrowserPageId as BrowserPageIdValue,
  BrowserProvider,
  BrowserScreenshot,
  BrowserScreenshotRequest,
  BrowserSnapshotRequest,
  Config,
} from './types.ts'

export type {
  BrowserAutomationProvider,
  BrowserTransferProvider,
  BrowserDownload,
  BrowserDownloadId,
  BrowserDownloadedFile,
  BrowserUploadRequest,
  BrowserClickRequest,
  BrowserClickResult,
  BrowserCloseRequest,
  BrowserCookieImportRequest,
  BrowserCookieInput,
  BrowserNavigationTarget,
  BrowserElement,
  BrowserElementCaptureProvider,
  BrowserElementCaptureRequest,
  BrowserElementCaptureTarget,
  BrowserElementScreenshot,
  BrowserElementSelection,
  BrowserElementSelectionRequest,
  BrowserHistoryEntry,
  BrowserNavigateRequest,
  BrowserNavigateResult,
  BrowserNetworkEntry,
  BrowserObservation,
  BrowserRect,
  BrowserOpenRequest,
  BrowserOpenResult,
  BrowserPage,
  BrowserProvider,
  BrowserScreenshot,
  BrowserScreenshotFormat,
  BrowserScreenshotRequest,
  BrowserSnapshotRequest,
  Config,
} from './types.ts'

/** Stable provider-issued browser page identifier. */
export type BrowserPageId = BrowserPageIdValue

/**
 * Brand one provider-issued browser page identifier.
 * @param value - Provider-issued page id.
 * @returns The branded page id.
 */
export function BrowserPageId(value: string): BrowserPageId {
  return value as BrowserPageId
}

/** Identifier for one accessibility observation of one browser page. */
export type BrowserObservationId = BrowserObservationIdValue

/**
 * Brand one provider-issued browser observation identifier.
 * @param value - Provider-issued observation id.
 * @returns The branded observation id.
 */
export function BrowserObservationId(value: string): BrowserObservationId {
  return value as BrowserObservationId
}

/** Element identifier valid only within its owning browser observation. */
export type BrowserElementId = BrowserElementIdValue

/**
 * Brand one element identifier from a browser observation.
 * @param value - Provider-issued element id.
 * @returns The branded element id.
 */
export function BrowserElementId(value: string): BrowserElementId {
  return value as BrowserElementId
}

/** Temporary identifier for one human-selected browser element. */
export type BrowserElementSelectionId = BrowserElementSelectionIdValue

/**
 * Brand one provider-issued browser element selection identifier.
 * @param value - Provider-issued selection id.
 * @returns The branded selection id.
 */
export function BrowserElementSelectionId(value: string): BrowserElementSelectionId {
  return value as BrowserElementSelectionId
}

/** Typed browser failure with a machine-routable open-string code. */
export class BrowserError extends HarnessError {}

declare module '@deepseek-ai/cordis' {
  interface Context {
    browser: BrowserRuntime
  }
}

const CONFIG_KEYS = new Set(['provider'])

function resolveConfig(config: Config): Config {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`browser: unsupported config key '${key}'`)
  }
  if (config.provider !== undefined && (
    config.provider.length === 0
    || config.provider.trim() !== config.provider
  )) {
    throw new Error('browser: provider must be a non-empty string without surrounding whitespace')
  }
  return config
}

/** Registry and execution facade for persistent browser providers. */
export class BrowserRuntime extends Service {
  static Config: z<Config> = z.object({ provider: z.string() })

  private readonly providers = new Map<string, BrowserProvider>()
  private readonly providerId: string | undefined

  /**
   * @param ctx - Cordis context that owns the browser service.
   * @param config - Optional explicit provider selection.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'browser')
    this.providerId = resolveConfig(config).provider
  }

  /**
   * Register one browser provider for the calling plugin lifetime.
   * @param provider - Provider implementation and stable id.
   * @returns A disposer that unregisters this exact contribution.
   */
  registerProvider(provider: BrowserProvider): () => void {
    if (provider.id.length === 0 || provider.id.trim() !== provider.id) {
      throw new BrowserError(
        'browser provider id must be a non-empty string without surrounding whitespace',
        'BROWSER_PROVIDER_ID_INVALID',
      )
    }
    if (this.providers.has(provider.id)) {
      throw new BrowserError(
        `browser provider '${provider.id}' is already registered`,
        'BROWSER_PROVIDER_DUPLICATE',
      )
    }
    const dispose = this.ctx.effect(function* (this: BrowserRuntime) {
      this.providers.set(provider.id, provider)
      yield () => { this.providers.delete(provider.id) }
    }.bind(this), 'browser.registerProvider()')
    return () => { void dispose() }
  }

  private provider(): BrowserProvider {
    if (this.providerId !== undefined) {
      const provider = this.providers.get(this.providerId)
      if (provider === undefined) {
        throw new BrowserError(
          `configured browser provider '${this.providerId}' is not registered`,
          'BROWSER_PROVIDER_CONFIGURED_MISSING',
        )
      }
      if (!provider.available()) {
        throw new BrowserError(
          `configured browser provider '${this.providerId}' is unavailable`,
          'BROWSER_PROVIDER_CONFIGURED_UNAVAILABLE',
        )
      }
      return provider
    }

    const usable = [...this.providers.values()].filter(provider => provider.available())
    const [single] = usable
    if (single === undefined) {
      throw new BrowserError('no usable browser provider is registered', 'BROWSER_PROVIDER_UNAVAILABLE')
    }
    if (usable.length > 1) {
      throw new BrowserError(
        `multiple usable browser providers are registered (${usable.map(provider => provider.id).join(', ')})`,
        'BROWSER_PROVIDER_AMBIGUOUS',
      )
    }
    return single
  }

  private elementCaptureProvider(): BrowserElementCaptureProvider {
    const provider = this.provider()
    const extension = provider as Partial<BrowserElementCaptureProvider>
    if (typeof extension.selectElement !== 'function' || typeof extension.captureElement !== 'function') {
      throw new BrowserError(
        `browser provider '${provider.id}' does not support element selection and capture`,
        'BROWSER_FEATURE_UNSUPPORTED',
      )
    }
    return provider as BrowserElementCaptureProvider
  }

  /**
   * List persistent pages through the selected provider.
   * @param signal - Optional cancellation signal.
   * @returns Current persistent browser pages.
   */
  async listPages(signal?: AbortSignal): Promise<readonly BrowserPage[]> {
    return this.provider().listPages(signal)
  }

  /**
   * Open one persistent page through the selected provider.
   * @param request - URL to open.
   * @param signal - Optional cancellation signal.
   * @returns The provider-issued page id.
   */
  async openPage(request: BrowserOpenRequest, signal?: AbortSignal): Promise<BrowserOpenResult> {
    return this.provider().openPage(request, signal)
  }

  /**
   * Navigate one persistent page and invalidate its prior observation.
   * @param request - Page id and destination URL.
   * @param signal - Optional cancellation signal.
   * @returns The resulting page location.
   */
  async navigate(request: BrowserNavigateRequest, signal?: AbortSignal): Promise<BrowserNavigateResult> {
    return this.provider().navigate(request, signal)
  }

  /**
   * Capture one accessibility observation.
   * @param request - Page to observe.
   * @param signal - Optional cancellation signal.
   * @returns The observation and its scoped element ids.
   */
  async snapshot(request: BrowserSnapshotRequest, signal?: AbortSignal): Promise<BrowserObservation> {
    return this.provider().snapshot(request, signal)
  }

  /**
   * Click one element from the exact current observation.
   * @param request - Page, observation, and element ids.
   * @param signal - Optional cancellation signal.
   * @returns The accepted click identity.
   */
  async click(request: BrowserClickRequest, signal?: AbortSignal): Promise<BrowserClickResult> {
    return this.provider().click(request, signal)
  }

  /**
   * Wait for one human-selected element through an optional Provider extension.
   * @param request - Page whose visible element the user selects.
   * @param signal - Optional cancellation signal.
   * @returns Temporary selection identity and element metadata.
   */
  async selectElement(
    request: BrowserElementSelectionRequest,
    signal?: AbortSignal,
  ): Promise<BrowserElementSelection> {
    return this.elementCaptureProvider().selectElement(request, signal)
  }

  /**
   * Capture one verified element crop through an optional Provider extension.
   * @param request - Page, exact target identity, and image encoding.
   * @param signal - Optional cancellation signal.
   * @returns Encoded crop bytes and the verified element metadata.
   */
  async captureElement(
    request: BrowserElementCaptureRequest,
    signal?: AbortSignal,
  ): Promise<BrowserElementScreenshot> {
    return this.elementCaptureProvider().captureElement(request, signal)
  }

  /**
   * Capture one encoded viewport screenshot.
   * @param request - Page and image encoding.
   * @param signal - Optional cancellation signal.
   * @returns Encoded image bytes for Consumer-owned attachment persistence.
   */
  async screenshot(request: BrowserScreenshotRequest, signal?: AbortSignal): Promise<BrowserScreenshot> {
    return this.provider().screenshot(request, signal)
  }

  private transferProvider(): BrowserTransferProvider {
    const provider = this.provider()
    const extension = provider as Partial<BrowserTransferProvider>
    if (typeof extension.upload !== 'function' || typeof extension.downloads !== 'function' || typeof extension.readDownload !== 'function') {
      throw new BrowserError('Selected Browser Provider does not support file transfers', 'BROWSER_FEATURE_UNSUPPORTED')
    }
    return provider as BrowserTransferProvider
  }

  /** Send explicit bytes to a current file input.
   * @param request - Observed input identity, safe filename, and bytes.
   * @param signal - Optional cancellation.
   * @returns Completion after the input receives bytes; page handlers may submit data.
   */
  async upload(request: BrowserUploadRequest, signal?: AbortSignal): Promise<void> {
    return this.transferProvider().upload(request, signal)
  }

  /** Read captured page-owned downloads.
   * @param pageId - Open page identity.
   * @param signal - Optional cancellation.
   * @returns Retained downloads and whether the retention limit refused new downloads.
   */
  async downloads(
    pageId: BrowserPageId, signal?: AbortSignal,
  ): Promise<{ readonly items: readonly BrowserDownload[]; readonly truncated: boolean }> {
    return this.transferProvider().downloads(pageId, signal)
  }

  /** Read a completed download without exposing filesystem paths.
   * @param pageId - Owning open page.
   * @param downloadId - Id returned by downloads.
   * @param maxBytes - Maximum accepted file bytes.
   * @param signal - Optional cancellation.
   * @returns Safe suggested filename and bounded bytes.
   */
  async readDownload(
    pageId: BrowserPageId, downloadId: BrowserDownloadId, maxBytes: number, signal?: AbortSignal,
  ): Promise<BrowserDownloadedFile> {
    return this.transferProvider().readDownload(pageId, downloadId, maxBytes, signal)
  }

  private automationProvider(): BrowserAutomationProvider {
    const provider = this.provider()
    const extension = provider as Partial<BrowserAutomationProvider>
    if (typeof extension.currentProfile !== 'function' || typeof extension.resolveNavigation !== 'function' || typeof extension.history !== 'function' || typeof extension.back !== 'function'
      || typeof extension.forward !== 'function' || typeof extension.network !== 'function'
      || typeof extension.importCookies !== 'function') {
      throw new BrowserError(
        `browser provider '${provider.id}' does not support native automation extensions`,
        'BROWSER_FEATURE_UNSUPPORTED',
      )
    }
    return provider as BrowserAutomationProvider
  }

  /** Read the active native profile without launching the browser.
   * @returns The configured profile name.
   */
  currentProfile(): string { return this.automationProvider().currentProfile() }

  /** Resolve a navigation intent using the active Provider configuration.
   * @param target - Home, search, or explicit URL intent.
   * @returns Validated destination for a later openPage call; performs no I/O.
   */
  resolveNavigation(target: BrowserNavigationTarget): BrowserOpenRequest { return this.automationProvider().resolveNavigation(target) }

  /** Read bounded navigation history for one persistent page.
   * @param pageId - An open page identity.
   * @param limit - Maximum returned entries, from 1 through 100.
   * @param signal - Optional cancellation.
   * @returns Recent visits in chronological order, without URL credentials or query values.
   */
  async history(pageId: BrowserPageId, limit: number, signal?: AbortSignal): Promise<readonly BrowserHistoryEntry[]> {
    return this.automationProvider().history(pageId, limit, signal)
  }

  /** Navigate one persistent page one step backward.
   * @param pageId - An open page identity.
   * @param signal - Optional cancellation.
   * @returns The resulting page location.
   */
  async back(pageId: BrowserPageId, signal?: AbortSignal): Promise<BrowserNavigateResult> {
    return this.automationProvider().back(pageId, signal)
  }

  /** Navigate one persistent page one step forward.
   * @param pageId - An open page identity.
   * @param signal - Optional cancellation.
   * @returns The resulting page location.
   */
  async forward(pageId: BrowserPageId, signal?: AbortSignal): Promise<BrowserNavigateResult> {
    return this.automationProvider().forward(pageId, signal)
  }

  /** Read bounded request/response observations captured by one page.
   * @param pageId - An open page identity.
   * @param limit - Maximum entries from 1 through 100.
   * @param signal - Optional cancellation.
   * @returns Metadata only; excludes headers, bodies, URL credentials, queries, and fragments.
   */
  async network(pageId: BrowserPageId, limit: number, signal?: AbortSignal): Promise<readonly BrowserNetworkEntry[]> {
    return this.automationProvider().network(pageId, limit, signal)
  }

  /** Import explicit cookies into an expected profile; never expose values through model tools.
   * @param request - Expected profile and cookies from trusted human input.
   * @param signal - Optional cancellation before import.
   * @returns The count accepted by the Provider, never cookie values.
   */
  async importCookies(request: BrowserCookieImportRequest, signal?: AbortSignal): Promise<{ readonly imported: number }> {
    return this.automationProvider().importCookies(request, signal)
  }

  /**
   * Close one persistent browser page.
   * @param request - Page to close.
   * @param signal - Optional cancellation signal.
   * @returns Completion after the provider confirms closure.
   */
  async closePage(request: BrowserCloseRequest, signal?: AbortSignal): Promise<void> {
    return this.provider().closePage(request, signal)
  }
}

export default BrowserRuntime
