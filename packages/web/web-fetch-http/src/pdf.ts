/**
 * Bounded PDF text extraction for {@link HttpFetchProvider}. `application/pdf`
 * bodies are binary, so they bypass the charset decoder entirely; pdf.js
 * parses the capped bytes on the main thread (Node has no DOM/worker canvas)
 * and the normalized output is plain text, capped by the same body-char limit
 * text fetches get.
 * @module @deepseek-ai/dsh-web-fetch-http/pdf
 */

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { WebError } from '@deepseek-ai/dsh-web'

/** Pages walked per PDF; real documents rarely exceed this and the cap bounds parse cost. */
const MAX_PDF_PAGES = 200

/** One extracted text item's normalized shape inside pdf.js `getTextContent` output. */
interface PdfTextItem {
  readonly str?: unknown
}

export interface PdfText {
  /** Extracted page text, capped at `maxChars`. */
  readonly content: string
  /** True when pages or characters were dropped by a bound. */
  readonly truncated: boolean
}

/**
 * Extract readable text from PDF bytes with pdf.js on the main thread.
 * Fails closed on unparseable input — a fetch that returns `application/pdf`
 * but cannot be decoded surfaces as a provider error, never as silent text.
 *
 * @param bytes - the already byte-capped response body.
 * @param maxChars - the provider's `maxBodyChars` text bound.
 * @param signal - caller/deadline cancellation, checked between pages.
 * @returns the extracted text and whether a bound cut it.
 */
export async function extractPdfText(bytes: Uint8Array, maxChars: number, signal: AbortSignal): Promise<PdfText> {
  const task = getDocument({
    data: bytes,
    useWorkerFetch: false,
    useSystemFonts: true,
  })
  let document: Awaited<typeof task.promise>
  try {
    document = await task.promise
  } catch (error: unknown) {
    throw new WebError('fetched PDF could not be parsed', 'WEB_PROVIDER_ERROR', { cause: error })
  }
  try {
    const pages = Math.min(document.numPages, MAX_PDF_PAGES)
    const truncatedPages = document.numPages > pages
    const parts: string[] = []
    let total = 0
    let truncatedChars = false
    for (let index = 1; index <= pages; index += 1) {
      signal.throwIfAborted()
      const page = await document.getPage(index)
      const text = await page.getTextContent()
      const lines = (text.items as readonly PdfTextItem[])
        .map(item => (typeof item.str === 'string' ? item.str : ''))
        .filter(str => str.length > 0)
        .join(' ')
        .trim()
      if (lines.length === 0) continue
      const remaining = maxChars - total
      if (remaining <= 0) {
        truncatedChars = true
        break
      }
      parts.push(lines.length > remaining ? lines.slice(0, remaining) : lines)
      if (lines.length > remaining) {
        truncatedChars = true
        break
      }
      total += lines.length + 1
    }
    return { content: parts.join('\n'), truncated: truncatedPages || truncatedChars }
  } finally {
    await task.destroy().catch(() => {
      // pdf.js cleanup is best-effort; extracted text already in hand.
    })
  }
}
