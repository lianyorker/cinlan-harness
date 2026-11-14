/**
 * httpx argv construction and `-json` line parsing. Pure functions so the
 * tool wrapper stays thin and the parser is unit-testable without httpx.
 *
 * @module @cinlan/tool-httpx/httpx
 */

/** Validated probe request accepted by {@link buildHttpxArgv}. */
export interface HttpxProbeRequest {
  /** Targets to probe: hostnames, IPv4/IPv6 addresses, URLs, or CIDR ranges. Never starts with `-`. */
  readonly targets: readonly string[]
  /** Probe `https://` (default true; httpx always tries both unless disabled). */
  readonly https?: boolean
  /** Probe `http://` (default true). */
  readonly http?: boolean
  /** `-status-code` — include the response status code. */
  readonly statusCode?: boolean
  /** `-title` — extract the page title. */
  readonly title?: boolean
  /** `-tech-detect` — report detected technologies. */
  readonly techDetect?: boolean
  /** `-follow-redirects` — follow 3xx responses. */
  readonly followRedirects?: boolean
  /** `-no-color` is always emitted; this field is reserved and currently ignored. */
  readonly _reserved?: never
}

const MAX_TARGET_LENGTH = 253
const TARGET_PATTERN = /^[A-Za-z0-9._:\-[\]/]+$/
const MAX_TARGETS = 1000

function validateTarget(target: string): string {
  const trimmed = target.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_TARGET_LENGTH || trimmed.startsWith('-')) {
    throw new TypeError(`tool-httpx: invalid probe target ${JSON.stringify(target)}`)
  }
  if (!TARGET_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-httpx: probe target contains unsupported characters ${JSON.stringify(target)}`)
  }
  return trimmed
}

/**
 * Build the httpx argv for one probe run. Output is always one JSON object
 * per line on stdout (`-json`); `-no-color` is always emitted so ANSI escape
 * sequences never reach the parser.
 * @param httpxPath - resolved httpx executable path.
 * @param request - validated probe request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildHttpxArgv(httpxPath: string, request: HttpxProbeRequest): string[] {
  const targets = request.targets.map(validateTarget)
  if (targets.length === 0) throw new TypeError('tool-httpx: at least one target is required')
  if (targets.length > MAX_TARGETS) throw new TypeError(`tool-httpx: at most ${MAX_TARGETS} targets per run`)
  const argv: string[] = [httpxPath, '-json', '-no-color', '-silent']
  if (request.statusCode === true) argv.push('-status-code')
  if (request.title === true) argv.push('-title')
  if (request.techDetect === true) argv.push('-tech-detect')
  if (request.followRedirects === true) argv.push('-follow-redirects')
  if (request.https === false) argv.push('-no-https')
  if (request.http === false) argv.push('-no-http')
  argv.push(...targets)
  return argv
}

/** One probed URL row from httpx `-json` output. */
export interface HttpxProbeResult {
  /** Scheme + host + port actually probed, e.g. `https://scanme.nmap.org`. */
  readonly url?: string
  /** Input as given when it differs from the probed URL. */
  readonly input?: string
  /** HTTP status code when `-status-code` is on. */
  readonly statusCode?: number
  /** Response `Content-Type`. */
  readonly contentType?: string
  /** Response length in bytes, when reported. */
  readonly contentLength?: number
  /** Page title when `-title` is on. */
  readonly title?: string
  /** Detected technologies when `-tech-detect` is on. */
  readonly technologies?: readonly string[]
  /** Server response header. */
  readonly webserver?: string
  /** CDN name when httpx detects one. */
  readonly cdn?: string
  /** Response time in seconds, when reported. */
  readonly time?: string
  /** Final URL after redirects, when different. */
  readonly finalUrl?: string
}

/**
 * Parse httpx `-json` stdout: one JSON object per line; unparseable lines are
 * skipped rather than failing the whole run.
 * @param stdout - complete stdout text.
 * @returns parsed probe rows in output order.
 */
export function parseHttpxJsonLines(stdout: string): readonly HttpxProbeResult[] {
  const results: HttpxProbeResult[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || !trimmed.startsWith('{')) continue
    let record: Record<string, unknown>
    try {
      record = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }
    const result: { -readonly [K in keyof HttpxProbeResult]?: HttpxProbeResult[K] } = {}
    if (typeof record.url === 'string' && record.url.length > 0) result.url = record.url
    if (typeof record.input === 'string' && record.input.length > 0) result.input = record.input
    if (typeof record.status_code === 'number') result.statusCode = record.status_code
    if (typeof record['content-type'] === 'string') result.contentType = record['content-type']
    if (typeof record.content_length === 'number') result.contentLength = record.content_length
    if (typeof record.title === 'string' && record.title.length > 0) result.title = record.title
    if (Array.isArray(record.technologies)) {
      const tech = record.technologies.filter((t): t is string => typeof t === 'string' && t.length > 0)
      if (tech.length > 0) result.technologies = tech
    }
    if (typeof record.webserver === 'string' && record.webserver.length > 0) result.webserver = record.webserver
    if (typeof record.cdn === 'string' && record.cdn.length > 0) result.cdn = record.cdn
    if (typeof record.time === 'string') result.time = record.time
    if (typeof record.final_url === 'string' && record.final_url.length > 0) result.finalUrl = record.final_url
    if (result.url !== undefined || result.input !== undefined) results.push(result)
  }
  return results
}
