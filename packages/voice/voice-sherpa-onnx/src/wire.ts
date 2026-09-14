/**
 * Wire helpers for the /voice/api JSON route: bounded body reading, response
 * writing, and the shared error envelope. Mirrors the established
 * @deepseek-ai/dsh-client-ui-better-sidebar /sidebar/api envelope shape
 * (copied, not imported — that package is unrelated and does not export
 * these helpers).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Machine-readable error codes of the /voice/api route. */
export type VoiceApiErrorCode = 'bad-request' | 'not-found' | 'forbidden' | 'method-error' | 'internal'

/** One API failure with its wire code and HTTP status. */
export class VoiceApiError extends Error {
  constructor(
    readonly code: VoiceApiErrorCode,
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

/** Body size bound of one JSON request (defense against unbounded reads). Audio clips ride this route base64-encoded. */
const MAX_BODY_BYTES = 32 << 20

/**
 * Read and parse one bounded JSON request body.
 * @param req - incoming request stream.
 * @returns parsed JSON value, or an empty object for an empty body.
 */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Uint8Array)
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new VoiceApiError('bad-request', 'request body too large')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new VoiceApiError('bad-request', 'request body is not valid JSON')
  }
}

/**
 * Write one JSON response.
 * @param res - response receiving headers and payload.
 * @param status - HTTP status code.
 * @param body - JSON-serializable response value.
 */
export function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

/**
 * Write the successful Voice API envelope.
 * @param res - response receiving the envelope.
 * @param value - successful response value.
 */
export function writeOk(res: ServerResponse, value: unknown): void {
  writeJson(res, 200, { ok: true, value })
}

/**
 * Write the failure envelope for any thrown value (unknown to internal 500).
 * A VoiceApiError carries its own wire code and status. Any other Error
 * carrying a stable machine-routable `code` string (e.g. this package's
 * VoiceError from @deepseek-ai/dsh-voice) surfaces that code at a 500 status
 * instead of collapsing to the generic 'internal' code — the settings page
 * and Ctrl+Shift+E client distinguish, for example, VOICE_ENGINE_DEGRADED from an
 * ordinary internal failure.
 * @param res - response receiving the failure envelope.
 * @param error - thrown value to classify.
 */
export function writeError(res: ServerResponse, error: unknown): void {
  if (error instanceof VoiceApiError) {
    writeJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
    return
  }
  if (error instanceof Error && typeof (error as { code?: unknown }).code === 'string') {
    writeJson(res, 500, { ok: false, error: { code: (error as unknown as { code: string }).code, message: error.message } })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  writeJson(res, 500, { ok: false, error: { code: 'internal', message } })
}

/**
 * Read one required non-empty string from an unknown payload.
 * @param payload - parsed request body.
 * @param key - property to read.
 * @returns required string value.
 */
export function requireString(payload: unknown, key: string): string {
  const record = payload as Record<string, unknown> | null
  const value = record?.[key]
  if (typeof value !== 'string' || value === '') throw new VoiceApiError('bad-request', `missing or invalid "${key}"`)
  return value
}
