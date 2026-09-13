/**
 * Host-side element crop for the Cinlan provider. `orca screenshot` returns
 * only a full-viewport image; the Cinlan CLI has no per-element crop command,
 * so this module crops the decoded viewport bytes to the verified CSS-pixel
 * element rectangle, converting to device pixels through the ratio between
 * the decoded image size and the reported CSS viewport size.
 * @module @deepseek-ai/dsh-browser-cinlan/crop
 */

import sharp from 'sharp'
import { BrowserError } from '@deepseek-ai/dsh-browser'
import type { BrowserRect, BrowserScreenshotFormat } from '@deepseek-ai/dsh-browser'
import type { RawElementRect } from './protocol.ts'

/**
 * Clamp a CSS-pixel element rectangle to the CSS viewport and reject bounds
 * that are non-finite, empty, or larger than the configured pixel budget.
 * @param rect - Raw element rectangle reported by an `orca eval` script.
 * @param viewport - CSS viewport size reported by the same script.
 * @param maxPixels - Maximum CSS-pixel area (width × height) admitted.
 * @returns The clamped CSS-pixel rectangle.
 */
export function boundedElementRect(
  rect: RawElementRect,
  viewport: { readonly width: number; readonly height: number },
  maxPixels: number,
): BrowserRect {
  const values = [rect.x, rect.y, rect.width, rect.height, viewport.width, viewport.height]
  if (values.some(value => !Number.isFinite(value))
    || rect.width <= 0
    || rect.height <= 0
    || viewport.width <= 0
    || viewport.height <= 0) {
    throw new BrowserError('browser-cinlan: element has no finite visible bounds', 'BROWSER_ELEMENT_CAPTURE_BOUNDS')
  }
  const x = Math.max(0, rect.x)
  const y = Math.max(0, rect.y)
  const right = Math.min(viewport.width, rect.x + rect.width)
  const bottom = Math.min(viewport.height, rect.y + rect.height)
  const width = right - x
  const height = bottom - y
  if (width <= 0 || height <= 0 || width * height > maxPixels) {
    throw new BrowserError(
      'browser-cinlan: element bounds are outside the viewport or exceed the capture pixel limit',
      'BROWSER_ELEMENT_CAPTURE_BOUNDS',
    )
  }
  return { x, y, width, height }
}

/**
 * Decode one `orca screenshot` viewport image and crop it to one verified
 * CSS-pixel element rectangle, scaling by the image/viewport size ratio.
 * @param data - Complete decoded viewport screenshot bytes.
 * @param format - Encoding the caller requested; the crop is re-encoded to it.
 * @param rect - CSS-pixel element rectangle, already bounded by {@link boundedElementRect}.
 * @param viewport - CSS viewport size the rectangle was measured against.
 * @param maxCaptureBytes - Maximum encoded crop byte length.
 * @returns The cropped, re-encoded image bytes.
 */
export async function cropElementScreenshot(
  data: Uint8Array,
  format: BrowserScreenshotFormat,
  rect: BrowserRect,
  viewport: { readonly width: number; readonly height: number },
  maxCaptureBytes: number,
): Promise<Uint8Array> {
  let image: ReturnType<typeof sharp>
  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>
  try {
    image = sharp(Buffer.from(data))
    metadata = await image.metadata()
  } catch (error) {
    throw new BrowserError(
      'browser-cinlan: could not decode the viewport screenshot for cropping',
      'BROWSER_ELEMENT_CAPTURE_FAILED',
      { cause: error },
    )
  }
  if (metadata.format !== format) {
    throw new BrowserError(
      'browser-cinlan: viewport screenshot encoding does not match the requested format',
      'BROWSER_CINLAN_PROTOCOL',
    )
  }
  const imageWidth = metadata.width
  const imageHeight = metadata.height
  if (imageWidth === undefined || imageHeight === undefined || imageWidth <= 0 || imageHeight <= 0) {
    throw new BrowserError(
      'browser-cinlan: viewport screenshot has no decodable dimensions',
      'BROWSER_ELEMENT_CAPTURE_FAILED',
    )
  }
  const scaleX = imageWidth / viewport.width
  const scaleY = imageHeight / viewport.height
  const left = Math.min(imageWidth - 1, Math.max(0, Math.round(rect.x * scaleX)))
  const top = Math.min(imageHeight - 1, Math.max(0, Math.round(rect.y * scaleY)))
  const width = Math.max(1, Math.min(imageWidth - left, Math.round(rect.width * scaleX)))
  const height = Math.max(1, Math.min(imageHeight - top, Math.round(rect.height * scaleY)))
  let cropped: Buffer
  try {
    const extracted = image.extract({ left, top, width, height })
    cropped = await (format === 'png' ? extracted.png() : extracted.jpeg()).toBuffer()
  } catch (error) {
    throw new BrowserError('browser-cinlan: could not crop the viewport screenshot', 'BROWSER_ELEMENT_CAPTURE_FAILED', { cause: error })
  }
  if (cropped.byteLength > maxCaptureBytes) {
    throw new BrowserError(
      `browser-cinlan: element screenshot exceeds the configured ${maxCaptureBytes}-byte limit`,
      'BROWSER_ELEMENT_CAPTURE_TOO_LARGE',
    )
  }
  return Uint8Array.from(cropped)
}
