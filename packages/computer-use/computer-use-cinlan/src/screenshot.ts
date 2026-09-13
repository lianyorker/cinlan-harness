/** Bounded ingestion for temporary PNG screenshots returned by Cinlan Computer Use. */

import { lstat, readFile } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import { ComputerUseError } from '@deepseek-ai/dsh-computer-use'
import type { ComputerScreenshot } from '@deepseek-ai/dsh-computer-use'
import type { ParsedScreenshotSource } from './protocol.ts'

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const PNG_MAGIC = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

function screenshotError(message: string, code = 'COMPUTER_SCREENSHOT_INVALID'): ComputerUseError {
  return new ComputerUseError(`computer-use-cinlan: ${message}`, code)
}

function assertPng(data: Uint8Array): void {
  if (data.byteLength < PNG_MAGIC.byteLength
    || PNG_MAGIC.some((byte, index) => data[index] !== byte)) {
    throw screenshotError('screenshot data is not a PNG image')
  }
}

function decodeInline(encoded: string, maxImageBytes: number): Uint8Array {
  if (encoded.length === 0 || !BASE64.test(encoded)) {
    throw screenshotError('screenshot data must be canonical padded base64')
  }
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  const decodedBytes = (encoded.length / 4) * 3 - padding
  if (decodedBytes > maxImageBytes) {
    throw screenshotError(`screenshot exceeds the configured ${maxImageBytes}-byte limit`, 'COMPUTER_SCREENSHOT_TOO_LARGE')
  }
  return Uint8Array.from(Buffer.from(encoded, 'base64'))
}

async function readTemporary(path: string, expiresAt: string | undefined, maxImageBytes: number): Promise<Uint8Array> {
  if (!isAbsolute(path) || extname(path).toLowerCase() !== '.png') {
    throw screenshotError('screenshot path must be an absolute PNG path')
  }
  if (expiresAt !== undefined) {
    const expiry = Date.parse(expiresAt)
    if (!Number.isFinite(expiry) || expiry <= Date.now()) {
      throw screenshotError('screenshot path is expired or has an invalid expiry')
    }
  }
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw screenshotError('screenshot path must reference a regular file')
  if (info.size < 1) throw screenshotError('screenshot file is empty')
  if (info.size > maxImageBytes) {
    throw screenshotError(`screenshot exceeds the configured ${maxImageBytes}-byte limit`, 'COMPUTER_SCREENSHOT_TOO_LARGE')
  }
  const data = await readFile(path)
  /* v8 ignore next -- this requires a file-size race between the adjacent lstat and readFile calls. */
  if (data.byteLength !== info.size) throw screenshotError('screenshot file changed while it was read')
  return Uint8Array.from(data)
}

/**
 * Ingest one inline or temporary-path screenshot without exposing its path.
 * @param source - Parsed public CLI screenshot fields.
 * @param maxImageBytes - Maximum accepted PNG byte length.
 * @returns Validated PNG bytes and dimensions.
 */
export async function loadComputerScreenshot(
  source: ParsedScreenshotSource,
  maxImageBytes: number,
): Promise<ComputerScreenshot> {
  let data: Uint8Array
  if (source.data !== undefined) {
    data = decodeInline(source.data, maxImageBytes)
  } else if (source.path !== undefined) {
    data = await readTemporary(source.path, source.expiresAt, maxImageBytes)
  } else {
    throw screenshotError('screenshot must publish inline data or a temporary path')
  }
  /* v8 ignore next -- both source readers reject empty data before returning. */
  if (data.byteLength === 0) throw screenshotError('screenshot data is empty')
  /* v8 ignore next -- both source readers enforce the same byte limit before returning. */
  if (data.byteLength > maxImageBytes) {
    throw screenshotError(`screenshot exceeds the configured ${maxImageBytes}-byte limit`, 'COMPUTER_SCREENSHOT_TOO_LARGE')
  }
  assertPng(data)
  return {
    mediaType: 'image/png',
    data,
    width: source.width,
    height: source.height,
    scale: source.scale,
  }
}
