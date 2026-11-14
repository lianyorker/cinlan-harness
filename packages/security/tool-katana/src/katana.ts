/**
 * katana argv construction and `-json` line parsing. Pure functions so the
 * tool wrapper stays thin and the parser is unit-testable without katana.
 *
 * @module @cinlan/tool-katana/katana
 */

/** Validated crawl request accepted by {@link buildKatanaArgv}. */
export interface KatanaCrawlRequest {
  /** Crawl start URL (`http://` or `https://`). Never starts with `-`. */
  readonly url: string
  /** `-d` maximum crawl depth, 1..5. Default 3. */
  readonly depth?: number
  /** `-c` concurrent worker count; must be within the deployment cap. */
  readonly concurrency?: number
}

/** Deployment-side maximum for the model-selected `-d` depth. */
export const MAX_DEPTH_ABSOLUTE = 5

const MAX_URL_LENGTH = 2048
const URL_PATTERN = /^https?:\/\/[^\s]+$/

function validateUrl(url: string): string {
  const trimmed = url.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH || trimmed.startsWith('-')) {
    throw new TypeError(`tool-katana: invalid crawl URL ${JSON.stringify(url)}`)
  }
  if (!URL_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-katana: crawl URL must be an absolute http(s) URL ${JSON.stringify(url)}`)
  }
  return trimmed
}

/**
 * Build the katana argv for one crawl run. Output is always line-delimited
 * JSON on stdout (`-json`); `-silent` and `-no-color` are fixed so progress
 * noise never leaks into the parsed stream. No output-file or callback
 * arguments (e.g. interactsh URLs) are ever emitted.
 * @param katanaPath - resolved katana executable path.
 * @param request - validated crawl request.
 * @param maxConcurrency - deployment cap for the worker count.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildKatanaArgv(katanaPath: string, request: KatanaCrawlRequest, maxConcurrency: number): string[] {
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new TypeError('tool-katana: maxConcurrency must be a positive safe integer')
  }
  const url = validateUrl(request.url)
  const depth = request.depth ?? 3
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > MAX_DEPTH_ABSOLUTE) {
    throw new TypeError(`tool-katana: depth must be an integer between 1 and ${MAX_DEPTH_ABSOLUTE}`)
  }
  const argv: string[] = [katanaPath, '-json', '-silent', '-no-color', '-u', url, '-d', String(depth)]
  if (request.concurrency !== undefined) {
    if (!Number.isSafeInteger(request.concurrency) || request.concurrency < 1 || request.concurrency > maxConcurrency) {
      throw new TypeError(`tool-katana: concurrency must be an integer between 1 and ${maxConcurrency}`)
    }
    argv.push('-c', String(request.concurrency))
  }
  return argv
}

/** One crawled discovery row. */
export interface KatanaRow {
  readonly url: string
  readonly method?: string
  readonly status?: number
  readonly contentLength?: number
  readonly contentType?: string
  readonly timestamp?: string
  /** Discovery source of the row (e.g. `cli`, `finder`). */
  readonly source?: string
  /** Finding tag describing what produced the URL (e.g. `a`, `form`). */
  readonly tag?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function nested(record: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = record[key]
  return isRecord(value) ? value : undefined
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key]
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

/**
 * Parse katana `-json` stdout: one JSON object per line; unparseable lines
 * are skipped rather than failing the whole run.
 * @param stdout - complete stdout text.
 * @returns parsed discovery rows in output order.
 */
export function parseKatanaJsonLines(stdout: string): readonly KatanaRow[] {
  const rows: {
    url: string
    method?: string
    status?: number
    contentLength?: number
    contentType?: string
    timestamp?: string
    source?: string
    tag?: string
  }[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || !trimmed.startsWith('{')) continue
    let record: Record<string, unknown>
    try {
      record = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }
    const request = nested(record, 'request')
    const response = nested(record, 'response')
    const url = stringField(record, 'url') ?? stringField(request, 'url')
    if (url === undefined) continue
    const row: {
      url: string
      method?: string
      status?: number
      contentLength?: number
      contentType?: string
      timestamp?: string
      source?: string
      tag?: string
    } = { url }
    const method = stringField(request, 'method') ?? stringField(record, 'method')
    if (method !== undefined) row.method = method
    const status = numberField(response, 'status_code') ?? numberField(record, 'status')
    if (status !== undefined) row.status = status
    const contentLength = numberField(response, 'content_length') ?? numberField(record, 'content_length')
    if (contentLength !== undefined) row.contentLength = contentLength
    const contentType = stringField(response, 'content_type') ?? stringField(record, 'content_type')
    if (contentType !== undefined) row.contentType = contentType
    const timestamp = stringField(record, 'timestamp')
    if (timestamp !== undefined) row.timestamp = timestamp
    const source = stringField(record, 'source')
    if (source !== undefined) row.source = source
    const tag = stringField(record, 'tag')
    if (tag !== undefined) row.tag = tag
    rows.push(row)
  }
  return rows
}
