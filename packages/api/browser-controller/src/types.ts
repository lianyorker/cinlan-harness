/** Browser-safe Remote commands; cookie JSON is accepted only by explicit human actions. */
import type { BrowserDownload, BrowserDownloadId, BrowserObservation, BrowserObservationId, BrowserElementId, BrowserNavigationTarget, BrowserPage, BrowserPageId, BrowserHistoryEntry, BrowserNetworkEntry } from '@deepseek-ai/dsh-browser/types'
export type { BrowserNavigationTarget, BrowserPage, BrowserPageId, BrowserHistoryEntry, BrowserNetworkEntry }
/** Active Provider profile without exposing its filesystem location. */
export interface BrowserProfileValue { readonly profileName: string }
/** Explicit JSON cookie file import; the receipt never echoes file contents. */
export interface BrowserImportCookiesRequest { readonly profileName: string; readonly json: string }
/** Successful cookie import into the expected active profile. */
export interface BrowserImportCookiesValue { readonly imported: number; readonly profileName: string }
/** Active browser pages and their owning profile. */
export interface BrowserPagesValue { readonly profileName: string; readonly pages: readonly BrowserPage[]; readonly maxFileBytes: number }
/** Page identity for an existing native page. */
export interface BrowserPageRequest { readonly pageId: BrowserPageId }
/** A resolved navigation intent opens a new page. */
export interface BrowserOpenValue { readonly pageId: BrowserPageId }
/** Recent per-page visit metadata. */
export interface BrowserHistoryValue { readonly entries: readonly BrowserHistoryEntry[] }
/** Recent per-page request metadata, never headers or bodies. */
export interface BrowserNetworkValue { readonly entries: readonly BrowserNetworkEntry[] }
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A rejected cookie file or Browser operation, without input values. */
    'browser/invalid-request': Record<never, never>
    /** Native Browser service or operation is unavailable. */
    'browser/operation-failed': Record<never, never>
  }
}

/** Current page observation for explicit file-input selection. */
export interface BrowserObservationValue { readonly observation: BrowserObservation }
/** Explicit human file selection, bounded by maxFileBytes before decoding. */
export interface BrowserFileUploadRequest {
  readonly pageId: BrowserPageId
  readonly observationId: BrowserObservationId
  readonly elementId: BrowserElementId
  readonly name: string
  readonly base64: string
}
/** File input accepted these bytes; page handlers may subsequently submit data. */
export interface BrowserFileUploadValue { readonly bytes: number }
/** Captured transfers are retained only while the page remains open. */
export interface BrowserDownloadsValue { readonly items: readonly BrowserDownload[]; readonly truncated: boolean }
/** Read only a download issued by the named page. */
export interface BrowserDownloadRequest { readonly pageId: BrowserPageId; readonly downloadId: BrowserDownloadId }
/** Exact bounded bytes for a user-initiated browser save. */
export interface BrowserDownloadValue { readonly name: string; readonly base64: string; readonly bytes: number }
