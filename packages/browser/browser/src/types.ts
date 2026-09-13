/** Type-only declarations for the provider-neutral persistent browser capability. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable provider-issued browser page identifier. */
export type BrowserPageId = Branded<'BrowserPageId'>

/** Identifier for one accessibility observation of one browser page. */
export type BrowserObservationId = Branded<'BrowserObservationId'>

/** Element identifier valid only within its owning browser observation. */
export type BrowserElementId = Branded<'BrowserElementId'>

/** Temporary provider-issued identifier for one human-selected browser element. */
export type BrowserElementSelectionId = Branded<'BrowserElementSelectionId'>

/** Browser screenshot encoding supported by the capability. */
export type BrowserScreenshotFormat = 'png' | 'jpeg'

/** CSS-pixel rectangle in the current browser viewport. */
export interface BrowserRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** One persistent browser tab visible to the selected provider. */
export interface BrowserPage {
  readonly pageId: BrowserPageId
  readonly index: number
  readonly url: string
  readonly title: string
  readonly active: boolean
}

/** One element reference in an accessibility observation. */
export interface BrowserElement {
  readonly elementId: BrowserElementId
  readonly role: string
  readonly name: string
}

/** Accessibility observation whose element ids expire as one unit. */
export interface BrowserObservation {
  readonly observationId: BrowserObservationId
  readonly pageId: BrowserPageId
  readonly url: string
  readonly title: string
  readonly tree: string
  readonly elements: readonly BrowserElement[]
}

/** Result of opening a persistent browser page. */
export interface BrowserOpenResult {
  readonly pageId: BrowserPageId
}

/** Result of navigating one persistent browser page. */
export interface BrowserNavigateResult {
  readonly pageId: BrowserPageId
  readonly url: string
  readonly title: string
}

/** Result of clicking an element from the current page observation. */
export interface BrowserClickResult {
  readonly pageId: BrowserPageId
  readonly observationId: BrowserObservationId
  readonly elementId: BrowserElementId
}

/** Encoded viewport screenshot before a Consumer persists it as an attachment. */
export interface BrowserScreenshot {
  readonly pageId: BrowserPageId
  readonly format: BrowserScreenshotFormat
  readonly mediaType: 'image/png' | 'image/jpeg'
  readonly data: Uint8Array
}

/** Temporary human selection retained by an element-capture Provider. */
export interface BrowserElementSelection {
  readonly selectionId: BrowserElementSelectionId
  readonly pageId: BrowserPageId
  readonly tagName: string
  readonly role: string
  readonly name: string
  readonly text: string
  readonly rect: BrowserRect
}

/** Element identity accepted by a verified crop capture. */
export type BrowserElementCaptureTarget =
  | {
    readonly kind: 'observation'
    readonly observationId: BrowserObservationId
    readonly elementId: BrowserElementId
  }
  | {
    readonly kind: 'selection'
    readonly selectionId: BrowserElementSelectionId
  }

/** Encoded element crop whose identity and bounds were checked around capture. */
export interface BrowserElementScreenshot extends BrowserScreenshot {
  readonly target: BrowserElementCaptureTarget
  readonly rect: BrowserRect
  readonly viewport: { readonly width: number; readonly height: number }
  readonly verified: true
  readonly tagName: string
  readonly role: string
  readonly name: string
}

/** Request to open a persistent browser page. */
export interface BrowserOpenRequest {
  readonly url: string
}

/** Request to navigate an existing browser page. */
export interface BrowserNavigateRequest {
  readonly pageId: BrowserPageId
  readonly url: string
}

/** Request to capture an accessibility observation. */
export interface BrowserSnapshotRequest {
  readonly pageId: BrowserPageId
}

/** Request to click an element from one exact observation. */
export interface BrowserClickRequest {
  readonly pageId: BrowserPageId
  readonly observationId: BrowserObservationId
  readonly elementId: BrowserElementId
}

/** Request to capture one viewport screenshot. */
export interface BrowserScreenshotRequest {
  readonly pageId: BrowserPageId
  readonly format: BrowserScreenshotFormat
}

/** Request to wait for one human-selected element on a visible page. */
export interface BrowserElementSelectionRequest {
  readonly pageId: BrowserPageId
}

/** Request to capture one observation-bound or human-selected element. */
export interface BrowserElementCaptureRequest {
  readonly pageId: BrowserPageId
  readonly target: BrowserElementCaptureTarget
  readonly format: BrowserScreenshotFormat
}

/** One entry in a page's in-memory navigation history. */
export interface BrowserHistoryEntry {
  readonly url: string
  readonly title: string
  readonly at: number
}

/** One bounded network observation captured by a Browser provider. */
export interface BrowserNetworkEntry {
  readonly url: string
  readonly method: string
  readonly resourceType: string
  readonly status?: number
  readonly failed?: string
  readonly at: number
}

/** Cookie data imported only from explicit user input; persistent profiles retain accepted cookies. */
export interface BrowserCookieInput {
  readonly name: string
  readonly value: string
  readonly domain: string
  readonly path?: string
  readonly expires?: number
  readonly httpOnly?: boolean
  readonly secure?: boolean
  readonly sameSite?: 'Strict' | 'Lax' | 'None'
}

/** Navigation intent resolved before performing a browser effect. */
export type BrowserNavigationTarget =
  | { readonly kind: 'home' }
  | { readonly kind: 'search'; readonly query: string }
  | { readonly kind: 'url'; readonly url: string }

/** Explicit cookie import into an expected active profile. Values must not enter tool logs. */
export interface BrowserCookieImportRequest {
  readonly profileName: string
  readonly cookies: readonly BrowserCookieInput[]
}

/** Optional native operations beyond the core page/observation contract. */
export interface BrowserAutomationProvider extends BrowserProvider {
  /** Read the active profile without launching a browser.
   * @returns Active profile name.
   */
  currentProfile(): string
  /** Resolve a navigation intent without I/O.
   * @param target - Home, search, or URL intent.
   * @returns Validated destination using the active Provider preferences.
   */
  resolveNavigation(target: BrowserNavigationTarget): BrowserOpenRequest
  /** Read recent page-lifetime visits.
   * @param pageId - Open page identity.
   * @param limit - Maximum entries from 1 through 100.
   * @param signal - Optional cancellation.
   * @returns Chronological, detached visit metadata without URL credentials, queries, or fragments.
   */
  history(pageId: BrowserPageId, limit: number, signal?: AbortSignal): Promise<readonly BrowserHistoryEntry[]>
  /** Navigate backward; absence of history leaves the page unchanged.
   * @param pageId - Open page identity.
   * @param signal - Optional cancellation.
   * @returns Final page location.
   */
  back(pageId: BrowserPageId, signal?: AbortSignal): Promise<BrowserNavigateResult>
  /** Navigate forward; absence of history leaves the page unchanged.
   * @param pageId - Open page identity.
   * @param signal - Optional cancellation.
   * @returns Final page location.
   */
  forward(pageId: BrowserPageId, signal?: AbortSignal): Promise<BrowserNavigateResult>
  /** Read captured request metadata, never headers or bodies.
   * @param pageId - Open page identity.
   * @param limit - Maximum entries from 1 through 100.
   * @param signal - Optional cancellation.
   * @returns Detached request outcomes with URL credentials, queries, and fragments removed.
   */
  network(pageId: BrowserPageId, limit: number, signal?: AbortSignal): Promise<readonly BrowserNetworkEntry[]>
  /** Import explicit human-provided cookies into the expected profile.
   * @param request - Expected active profile and validated cookie fields.
   * @param signal - Optional cancellation.
   * @returns Accepted count only; failures and results must not echo values.
   */
  importCookies(request: BrowserCookieImportRequest, signal?: AbortSignal): Promise<{ readonly imported: number }>
}

/** Provider-issued identity of one captured browser download. */
export type BrowserDownloadId = Branded<'BrowserDownloadId'>
/** A browser download retained until its page or Provider closes. */
export interface BrowserDownload {
  readonly id: BrowserDownloadId
  readonly pageId: BrowserPageId
  readonly name: string
  readonly status: 'in-progress' | 'complete' | 'failed'
}
/** Bounded downloaded bytes; never names an arbitrary Host path. */
export interface BrowserDownloadedFile { readonly name: string; readonly data: Uint8Array }
/** An observed file input receives explicit bytes rather than a Host path. */
export interface BrowserUploadRequest extends BrowserClickRequest {
  readonly name: string
  readonly data: Uint8Array
}
/** Optional file transfers implemented in the browser execution world. */
export interface BrowserTransferProvider extends BrowserProvider {
  /** Set an observation-bound file input; page input/change handlers may run.
   * @param request - Current input identity, basename, and bytes.
   * @param signal - Optional cancellation.
   * @returns Completion after browser acceptance; the observation is consumed.
   */
  upload(request: BrowserUploadRequest, signal?: AbortSignal): Promise<void>
  /** List downloads captured for an open page.
   * @param pageId - Open page identity.
   * @param signal - Optional cancellation.
   * @returns Page-owned ids, names, statuses, and whether the count limit refused additional downloads.
   */
  downloads(pageId: BrowserPageId, signal?: AbortSignal): Promise<{
    readonly items: readonly BrowserDownload[]
    readonly truncated: boolean
  }>
  /** Read a completed page-owned download within the caller's byte limit.
   * @param pageId - Owning open page.
   * @param downloadId - Captured download identity.
   * @param maxBytes - Requested maximum bytes; Provider limits may be stricter.
   * @param signal - Optional cancellation.
   * @returns Safe suggested filename and complete bytes, never a filesystem path.
   */
  readDownload(pageId: BrowserPageId, downloadId: BrowserDownloadId, maxBytes: number, signal?: AbortSignal): Promise<BrowserDownloadedFile>
}

/** Request to close one persistent browser page. */
export interface BrowserCloseRequest {
  readonly pageId: BrowserPageId
}

/**
 * Provider implementation for persistent browser tabs. `available()` is a
 * cheap local check and must not launch a process or contact a runtime.
 */
export interface BrowserProvider {
  readonly id: string
  available(): boolean
  listPages(signal?: AbortSignal): Promise<readonly BrowserPage[]>
  openPage(request: BrowserOpenRequest, signal?: AbortSignal): Promise<BrowserOpenResult>
  navigate(request: BrowserNavigateRequest, signal?: AbortSignal): Promise<BrowserNavigateResult>
  snapshot(request: BrowserSnapshotRequest, signal?: AbortSignal): Promise<BrowserObservation>
  click(request: BrowserClickRequest, signal?: AbortSignal): Promise<BrowserClickResult>
  screenshot(request: BrowserScreenshotRequest, signal?: AbortSignal): Promise<BrowserScreenshot>
  closePage(request: BrowserCloseRequest, signal?: AbortSignal): Promise<void>
}

/** Optional Provider extension for temporary element selection and verified crops. */
export interface BrowserElementCaptureProvider extends BrowserProvider {
  selectElement(request: BrowserElementSelectionRequest, signal?: AbortSignal): Promise<BrowserElementSelection>
  captureElement(request: BrowserElementCaptureRequest, signal?: AbortSignal): Promise<BrowserElementScreenshot>
}

/** Provider-selection config for the browser runtime. */
export interface Config {
  /** Explicit provider id. Omitted auto-selects exactly one usable provider. */
  readonly provider?: string
}
