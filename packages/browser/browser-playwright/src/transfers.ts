/** Native browser file transfer validation and bounded download reads. */
import type { Download } from 'playwright-core'
import { finished } from 'node:stream/promises'
import { BrowserError } from '@deepseek-ai/dsh-browser'

/** Normalize browser-suggested names to inert download filenames.
 * @param name - Untrusted suggested filename.
 * @returns A basename without path separators, controls, or reserved Windows characters.
 */
export function downloadName(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  const safe = base.replace(/[\x00-\x1f\x7f<>:"|?*]/g, '_').slice(0, 180).replace(/[. ]+$/g, '')
  return safe.length === 0 || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(safe) ? 'download.bin' : safe
}

/** Validate a user-chosen upload basename without silently rewriting it.
 * @param name - Filename submitted alongside explicit bytes.
 */
export function assertUploadName(name: string): void {
  if (name.length === 0 || name.length > 180 || downloadName(name) !== name) {
    throw new BrowserError('Upload filename is invalid', 'BROWSER_REQUEST_INVALID')
  }
}

/** Read browser-owned downloaded data without unbounded allocation or accepting a Host path.
 * @param download - Completed browser-owned transfer.
 * @param maxBytes - Maximum retained bytes.
 * @param signal - Combined page and Provider cancellation.
 * @returns Exact bytes; oversized streams are destroyed without returning partial data.
 */
export async function downloadBytes(download: Download, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted()
  const stream = await download.createReadStream()
  const cancel = (): void => { stream.destroy(new Error('Browser download read cancelled')) }
  stream.on('error', () => { /* Stream failures are consumed by the async iterator below. */ })
  signal.addEventListener('abort', cancel, { once: true })
  const chunks: Buffer[] = []
  let size = 0
  try {
    signal.throwIfAborted()
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      signal.throwIfAborted()
      size += chunk.byteLength
      if (size > maxBytes) throw new BrowserError('Download exceeds the configured byte limit', 'BROWSER_TRANSFER_TOO_LARGE')
      chunks.push(chunk)
    }
    signal.throwIfAborted()
    return new Uint8Array(Buffer.concat(chunks, size))
  } finally {
    signal.removeEventListener('abort', cancel)
    stream.destroy()
    await finished(stream, { cleanup: true }).catch(() => { /* The read or cancellation already owns this stream failure. */ })
  }
}
