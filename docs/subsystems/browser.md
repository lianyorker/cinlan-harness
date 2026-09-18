# Browser

English | [中文](browser.zh.md)

## Summary

This reference lists the Cordis API declared by the `packages/browser` group. The [Browser Service Definition](../../packages/browser/browser/README.md) owns persistent page and observation identities, Provider selection, freshness, native navigation, capture, and transfer requests. [API-owned browser records](typert.md#browser) project those capabilities for authenticated human requests.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbrowser--browserruntime"></a>

### `ctx.browser` — `BrowserRuntime`

Registry and execution facade for persistent browser providers.

```ts cordis-catalog
/**
 * Register one browser provider for the calling plugin lifetime.
 * @param provider - Provider implementation and stable id.
 * @returns A disposer that unregisters this exact contribution.
 */
registerProvider(provider: BrowserProvider): () => void

/**
 * List persistent pages through the selected provider.
 * @param signal - Optional cancellation signal.
 * @returns Current persistent browser pages.
 */
async listPages(signal?: AbortSignal): Promise<readonly BrowserPage[]>

/**
 * Open one persistent page through the selected provider.
 * @param request - URL to open.
 * @param signal - Optional cancellation signal.
 * @returns The provider-issued page id.
 */
async openPage(request: BrowserOpenRequest, signal?: AbortSignal): Promise<BrowserOpenResult>

/**
 * Navigate one persistent page and invalidate its prior observation.
 * @param request - Page id and destination URL.
 * @param signal - Optional cancellation signal.
 * @returns The resulting page location.
 */
async navigate(request: BrowserNavigateRequest, signal?: AbortSignal): Promise<BrowserNavigateResult>

/**
 * Capture one accessibility observation.
 * @param request - Page to observe.
 * @param signal - Optional cancellation signal.
 * @returns The observation and its scoped element ids.
 */
async snapshot(request: BrowserSnapshotRequest, signal?: AbortSignal): Promise<BrowserObservation>

/**
 * Click one element from the exact current observation.
 * @param request - Page, observation, and element ids.
 * @param signal - Optional cancellation signal.
 * @returns The accepted click identity.
 */
async click(request: BrowserClickRequest, signal?: AbortSignal): Promise<BrowserClickResult>

/**
 * Wait for one human-selected element through an optional Provider extension.
 * @param request - Page whose visible element the user selects.
 * @param signal - Optional cancellation signal.
 * @returns Temporary selection identity and element metadata.
 */
async selectElement( request: BrowserElementSelectionRequest, signal?: AbortSignal, ): Promise<BrowserElementSelection>

/**
 * Capture one verified element crop through an optional Provider extension.
 * @param request - Page, exact target identity, and image encoding.
 * @param signal - Optional cancellation signal.
 * @returns Encoded crop bytes and the verified element metadata.
 */
async captureElement( request: BrowserElementCaptureRequest, signal?: AbortSignal, ): Promise<BrowserElementScreenshot>

/**
 * Capture one encoded viewport screenshot.
 * @param request - Page and image encoding.
 * @param signal - Optional cancellation signal.
 * @returns Encoded image bytes for Consumer-owned attachment persistence.
 */
async screenshot(request: BrowserScreenshotRequest, signal?: AbortSignal): Promise<BrowserScreenshot>

/** Send explicit bytes to a current file input.
 * @param request - Observed input identity, safe filename, and bytes.
 * @param signal - Optional cancellation.
 * @returns Completion after the input receives bytes; page handlers may submit data.
 */
async upload(request: BrowserUploadRequest, signal?: AbortSignal): Promise<void>

/** Read captured page-owned downloads.
 * @param pageId - Open page identity.
 * @param signal - Optional cancellation.
 * @returns Retained downloads and whether the retention limit refused new downloads.
 */
async downloads( pageId: BrowserPageId, signal?: AbortSignal, ): Promise<{ readonly items: readonly BrowserDownload[]; readonly truncated: boolean }>

/** Read a completed download without exposing filesystem paths.
 * @param pageId - Owning open page.
 * @param downloadId - Id returned by downloads.
 * @param maxBytes - Maximum accepted file bytes.
 * @param signal - Optional cancellation.
 * @returns Safe suggested filename and bounded bytes.
 */
async readDownload( pageId: BrowserPageId, downloadId: BrowserDownloadId, maxBytes: number, signal?: AbortSignal, ): Promise<BrowserDownloadedFile>

/** Read the active native profile without launching the browser.
 * @returns The configured profile name.
 */
currentProfile(): string

/** Resolve a navigation intent using the active Provider configuration.
 * @param target - Home, search, or explicit URL intent.
 * @returns Validated destination for a later openPage call; performs no I/O.
 */
resolveNavigation(target: BrowserNavigationTarget): BrowserOpenRequest

/** Read bounded navigation history for one persistent page.
 * @param pageId - An open page identity.
 * @param limit - Maximum returned entries, from 1 through 100.
 * @param signal - Optional cancellation.
 * @returns Recent visits in chronological order, without URL credentials or query values.
 */
async history(pageId: BrowserPageId, limit: number, signal?: AbortSignal): Promise<readonly BrowserHistoryEntry[]>

/** Navigate one persistent page one step backward.
 * @param pageId - An open page identity.
 * @param signal - Optional cancellation.
 * @returns The resulting page location.
 */
async back(pageId: BrowserPageId, signal?: AbortSignal): Promise<BrowserNavigateResult>

/** Navigate one persistent page one step forward.
 * @param pageId - An open page identity.
 * @param signal - Optional cancellation.
 * @returns The resulting page location.
 */
async forward(pageId: BrowserPageId, signal?: AbortSignal): Promise<BrowserNavigateResult>

/** Read bounded request/response observations captured by one page.
 * @param pageId - An open page identity.
 * @param limit - Maximum entries from 1 through 100.
 * @param signal - Optional cancellation.
 * @returns Metadata only; excludes headers, bodies, URL credentials, queries, and fragments.
 */
async network(pageId: BrowserPageId, limit: number, signal?: AbortSignal): Promise<readonly BrowserNetworkEntry[]>

/** Import explicit cookies into an expected profile; never expose values through model tools.
 * @param request - Expected profile and cookies from trusted human input.
 * @param signal - Optional cancellation before import.
 * @returns The count accepted by the Provider, never cookie values.
 */
async importCookies(request: BrowserCookieImportRequest, signal?: AbortSignal): Promise<{ readonly imported: number }>

/**
 * Close one persistent browser page.
 * @param request - Page to close.
 * @param signal - Optional cancellation signal.
 * @returns Completion after the provider confirms closure.
 */
async closePage(request: BrowserCloseRequest, signal?: AbortSignal): Promise<void>
```

Source: [`packages/browser/browser/src/index.ts`](../../packages/browser/browser/src/index.ts)
<!-- END GENERATED cordis-surface -->
