/** Native Browser commands for authenticated Web clients; cookie values never enter model tools. */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-browser'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import schema from '@deepseek-ai/schemastery'
import type {
  BrowserObservationValue,
  BrowserFileUploadRequest,
  BrowserFileUploadValue,
  BrowserDownloadsValue,
  BrowserDownloadRequest,
  BrowserDownloadValue,
  BrowserHistoryValue,
  BrowserImportCookiesRequest,
  BrowserImportCookiesValue,
  BrowserNavigationTarget,
  BrowserNetworkValue,
  BrowserOpenValue,
  BrowserPageRequest,
  BrowserPagesValue,
  BrowserProfileValue,
} from './types.ts'
export type * from './types.ts'
declare module '@deepseek-ai/cordis' {
  interface Context { /** Host owner of explicit Browser Settings operations. */ browserController: BrowserController }
}
const cookie = z.strictObject({
  name: z.string().min(1).max(256), value: z.string().max(4096), domain: z.string().min(1).max(255),
  path: z.string().max(1024).optional(), expires: z.number().min(-1).optional(),
  secure: z.boolean().optional(), httpOnly: z.boolean().optional(), sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
})
/** Remote transfer byte budget; Provider limits may be stricter. */
export interface Config {
  /** Maximum decoded upload or download bytes accepted by this Remote. */
  readonly maxFileBytes?: number
}

/** Authenticated human-facing Browser operations, separate from model tool permissions. */
export class BrowserController extends TypertRemoteService {
  static inject = ['typert', 'browser']
  static Config: schema<Config> = schema.object({
    maxFileBytes: schema.number().step(1).min(1).max(100 * 1024 * 1024).default(4 * 1024 * 1024),
  })
  private readonly maxFileBytes: number
  /** @param ctx - Host context carrying the selected Browser Provider.
   * @param config - Maximum Remote transfer bytes.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'browserController', { namespace: 'browser' })
    if (Object.keys(config).some(key => key !== 'maxFileBytes')) throw new Error('Browser controller config contains unsupported fields')
    this.maxFileBytes = config.maxFileBytes ?? 4 * 1024 * 1024
    if (!Number.isSafeInteger(this.maxFileBytes) || this.maxFileBytes < 1 || this.maxFileBytes > 100 * 1024 * 1024) throw new Error('Browser maxFileBytes must be between 1 and 104857600')
  }
  /** Read the active profile without launching a browser.
   * @param signal - Caller cancellation.
   * @returns Active profile name.
   */
  @Remote('profile') profile(signal: AbortSignal): BrowserProfileValue {
    signal.throwIfAborted()
    return { profileName: this.ctx.browser.currentProfile() }
  }
  /** Launch if needed and list native pages after an explicit UI action.
   * @param signal - Caller cancellation.
   * @returns Current page and profile identities.
   */
  @Remote('pages') async pages(signal: AbortSignal): Promise<BrowserPagesValue> {
    signal.throwIfAborted()
    return {
      profileName: this.ctx.browser.currentProfile(), pages: await this.ctx.browser.listPages(signal), maxFileBytes: this.maxFileBytes,
    }
  }
  /** Resolve an intent and open it with the active Provider settings.
   * @param request - Home, search, or absolute URL intent.
   * @param signal - Caller cancellation.
   * @returns New page identity.
   */
  @Remote('open') async open(request: BrowserNavigationTarget, signal: AbortSignal): Promise<BrowserOpenValue> {
    signal.throwIfAborted()
    return this.ctx.browser.openPage(this.ctx.browser.resolveNavigation(request), signal)
  }
  /** Read page-local visits; nothing is loaded from another profile.
   * @param request - Open page identity.
   * @param signal - Caller cancellation.
   * @returns At most 100 visits; credentials, queries, and fragments are excluded.
   */
  @Remote('history') async history(request: BrowserPageRequest, signal: AbortSignal): Promise<BrowserHistoryValue> {
    return { entries: await this.ctx.browser.history(request.pageId, 100, signal) }
  }
  /** Read request metadata retained since the page opened.
   * @param request - Open page identity.
   * @param signal - Caller cancellation.
   * @returns At most 100 requests without headers, bodies, or URL query values.
   */
  @Remote('network') async network(request: BrowserPageRequest, signal: AbortSignal): Promise<BrowserNetworkValue> {
    return { entries: await this.ctx.browser.network(request.pageId, 100, signal) }
  }
  /** Observe a page so a human can select a file input.
   * @param request - Open page identity.
   * @param signal - Caller cancellation.
   * @returns Fresh observation and element ids.
   */
  @Remote('snapshot') async snapshot(request: BrowserPageRequest, signal: AbortSignal): Promise<BrowserObservationValue> {
    return { observation: await this.ctx.browser.snapshot(request, signal) }
  }
  /** Supply explicit file bytes to an observed input, without submitting its form.
   * @param request - Fresh observation ids, basename, and base64 from the chosen file.
   * @param signal - Caller cancellation.
   * @returns Accepted byte count, never file contents.
   */
  @Remote('upload') async upload(request: BrowserFileUploadRequest, signal: AbortSignal): Promise<BrowserFileUploadValue> {
    signal.throwIfAborted()
    if (request.base64.length > Math.ceil(this.maxFileBytes / 3) * 4) {
      throw new RemoteError('browser/invalid-request', 'File encoding or byte limit is invalid', {})
    }
    const data = Buffer.from(request.base64, 'base64')
    if (data.byteLength > this.maxFileBytes || data.toString('base64') !== request.base64) {
      throw new RemoteError('browser/invalid-request', 'File encoding or byte limit is invalid', {})
    }
    await this.ctx.browser.upload({
      pageId: request.pageId, observationId: request.observationId, elementId: request.elementId, name: request.name, data,
    }, signal)
    return { bytes: data.byteLength }
  }
  /** Read page-owned download metadata.
   * @param request - Open page identity.
   * @param signal - Caller cancellation.
   * @returns Retained download ids and states.
   */
  @Remote('downloads') async downloads(request: BrowserPageRequest, signal: AbortSignal): Promise<BrowserDownloadsValue> {
    return this.ctx.browser.downloads(request.pageId, signal)
  }
  /** Read one bounded completed download for a human save action.
   * @param request - Page and download ids obtained from downloads.
   * @param signal - Caller cancellation.
   * @returns Inert filename and exact file bytes encoded for Remote transport.
   */
  @Remote('download') async download(request: BrowserDownloadRequest, signal: AbortSignal): Promise<BrowserDownloadValue> {
    const file = await this.ctx.browser.readDownload(request.pageId, request.downloadId, this.maxFileBytes, signal)
    return { name: file.name, base64: Buffer.from(file.data).toString('base64'), bytes: file.data.byteLength }
  }

  /** Import an explicit cookie JSON array into the expected active profile.
   * @param request - Active profile name and user-selected file contents.
   * @param signal - Caller cancellation.
   * @returns Accepted count without cookie values; failures also omit values.
   */
  @Remote('importCookies') async importCookies(request: BrowserImportCookiesRequest, signal: AbortSignal): Promise<BrowserImportCookiesValue> {
    signal.throwIfAborted()
    if (Buffer.byteLength(request.json, 'utf8') > 262144) throw new RemoteError('browser/invalid-request', 'Cookie file exceeds 256 KiB', {})
    let parsed: unknown
    try { parsed = JSON.parse(request.json) as unknown } catch (_invalidCookieJson) {
      throw new RemoteError('browser/invalid-request', 'Cookie file must be a JSON array', {})
    }
    const result = z.array(cookie).min(1).max(1000).safeParse(parsed)
    if (!result.success) throw new RemoteError('browser/invalid-request', 'Cookie file contains invalid fields', {})
    try {
      const cookies = result.data.map(cookie => ({
        name: cookie.name, value: cookie.value, domain: cookie.domain,
        ...(cookie.path === undefined ? {} : { path: cookie.path }),
        ...(cookie.expires === undefined ? {} : { expires: cookie.expires }),
        ...(cookie.secure === undefined ? {} : { secure: cookie.secure }),
        ...(cookie.httpOnly === undefined ? {} : { httpOnly: cookie.httpOnly }),
        ...(cookie.sameSite === undefined ? {} : { sameSite: cookie.sameSite }),
      }))
      const receipt = await this.ctx.browser.importCookies({ profileName: request.profileName, cookies }, signal)
      return { imported: receipt.imported, profileName: request.profileName }
    } catch (_cookieOperationFailure) {
      signal.throwIfAborted()
      throw new RemoteError('browser/operation-failed', 'Cookie import failed; refresh the active profile and check the file', {})
    }
  }
}
export default BrowserController
