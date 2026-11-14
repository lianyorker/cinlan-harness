/**
 * ffuf argv construction and `-json` stdout parsing. Pure functions so the
 * tool wrapper stays thin and the parser is unit-testable without ffuf.
 *
 * @module @cinlan/tool-ffuf/ffuf
 */

/** Validated fuzz request accepted by {@link buildFfufArgv}. */
export interface FfufFuzzRequest {
  /** Target URL; must contain the `FUZZ` keyword exactly where the wordlist entries are substituted. Never starts with `-`. */
  readonly url: string
  /** Wordlist file path on the execution host (`-w`). Never starts with `-`. */
  readonly wordlist: string
  /** Additional keyword definitions (`-w <path>:<KEYWORD>`); validated pairs. */
  readonly extraWordlists?: readonly { readonly path: string; readonly keyword: string }[]
  /** HTTP method (`-X`). Default GET. */
  readonly method?: string
  /** Match status codes (`-mc`); default upstream is 200-299,301,302,307,308,401,403,405,500. */
  readonly matchCodes?: readonly number[]
  /** Auto-calibrate filters (`-ac`). Default true. */
  readonly autoCalibrate?: boolean
  /** Follow redirects (`-r`). Default false. */
  readonly followRedirects?: boolean
  /** Request timeout in seconds (`-timeout`). Default upstream 10. */
  readonly timeoutSeconds?: number
}

const MAX_URL_LENGTH = 2048
const URL_PATTERN = /^[A-Za-z0-9._~:@!$&'()*+,;=\-[\]/%?#]+$/
const KEYWORD_PATTERN = /^[A-Z][A-Z0-9_]*$/
const PATH_PATTERN = /^[A-Za-z0-9 ._\-\\/():+~[\]{}]+$/
const METHOD_PATTERN = /^[A-Z]+$/
const MAX_WORDLISTS = 8
const MAX_MATCH_CODES = 32

function validateUrl(url: string): string {
  const trimmed = url.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH || trimmed.startsWith('-')) {
    throw new TypeError(`tool-ffuf: invalid fuzz URL ${JSON.stringify(url)}`)
  }
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    throw new TypeError(`tool-ffuf: fuzz URL must start with http:// or https:// ${JSON.stringify(url)}`)
  }
  if (!URL_PATTERN.test(trimmed) || !trimmed.includes('FUZZ')) {
    throw new TypeError(`tool-ffuf: fuzz URL must contain the FUZZ keyword and only URL-safe characters ${JSON.stringify(url)}`)
  }
  return trimmed
}

function validatePath(path: string, label: string): string {
  const trimmed = path.trim()
  if (trimmed.length === 0 || trimmed.length > 1024 || trimmed.startsWith('-')) {
    throw new TypeError(`tool-ffuf: invalid ${label} path ${JSON.stringify(path)}`)
  }
  if (!PATH_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-ffuf: ${label} path contains unsupported characters ${JSON.stringify(path)}`)
  }
  return trimmed
}

/**
 * Build the ffuf argv for one fuzz run. Output is always JSON on stdout
 * (`-json -s`); `-ac` auto-calibration is on by default so noise responses
 * are filtered without manual filters.
 * @param ffufPath - resolved ffuf executable path.
 * @param request - validated fuzz request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildFfufArgv(ffufPath: string, request: FfufFuzzRequest): string[] {
  const url = validateUrl(request.url)
  const wordlist = validatePath(request.wordlist, 'wordlist')
  const argv: string[] = [ffufPath, '-w', wordlist]
  if (request.extraWordlists !== undefined) {
    if (request.extraWordlists.length > MAX_WORDLISTS) {
      throw new TypeError(`tool-ffuf: at most ${MAX_WORDLISTS} wordlists per run`)
    }
    for (const extra of request.extraWordlists) {
      const path = validatePath(extra.path, 'wordlist')
      const keyword = extra.keyword.trim()
      if (!KEYWORD_PATTERN.test(keyword)) {
        throw new TypeError(`tool-ffuf: invalid wordlist keyword ${JSON.stringify(extra.keyword)}`)
      }
      argv.push('-w', `${path}:${keyword}`)
    }
  }
  argv.push('-u', url, '-json', '-s')
  if (request.method !== undefined) {
    const method = request.method.trim()
    if (!METHOD_PATTERN.test(method) || method.length > 16) {
      throw new TypeError(`tool-ffuf: invalid HTTP method ${JSON.stringify(request.method)}`)
    }
    argv.push('-X', method)
  }
  if (request.matchCodes !== undefined && request.matchCodes.length > 0) {
    if (request.matchCodes.length > MAX_MATCH_CODES) {
      throw new TypeError(`tool-ffuf: at most ${MAX_MATCH_CODES} match codes`)
    }
    for (const code of request.matchCodes) {
      if (!Number.isSafeInteger(code) || code < 100 || code > 599) {
        throw new TypeError(`tool-ffuf: invalid match code ${JSON.stringify(code)}`)
      }
    }
    argv.push('-mc', request.matchCodes.join(','))
  }
  if (request.autoCalibrate !== false) argv.push('-ac')
  if (request.followRedirects === true) argv.push('-r')
  if (request.timeoutSeconds !== undefined) {
    if (!Number.isSafeInteger(request.timeoutSeconds) || request.timeoutSeconds < 1 || request.timeoutSeconds > 600) {
      throw new TypeError('tool-ffuf: timeoutSeconds must be an integer between 1 and 600')
    }
    argv.push('-timeout', String(request.timeoutSeconds))
  }
  return argv
}

/** One matched response row from ffuf `-json` output. */
export interface FfufMatch {
  /** Substituted wordlist value (FUZZ keyword input). */
  readonly keyword?: string
  /** Response URL after substitution. */
  readonly url?: string
  /** Response status code. */
  readonly status?: number
  /** Response body length in bytes. */
  readonly length?: number
  /** Response word count. */
  readonly words?: number
  /** Response line count. */
  readonly lines?: number
}

/**
 * Parse ffuf `-json` stdout: one JSON document with a `results` array.
 * Unparseable output yields an empty list rather than failing the run.
 * @param stdout - complete stdout text.
 * @returns parsed match rows in output order.
 */
export function parseFfufJson(stdout: string): readonly FfufMatch[] {
  let document: Record<string, unknown>
  try {
    document = JSON.parse(stdout) as Record<string, unknown>
  } catch {
    return []
  }
  if (!Array.isArray(document.results)) return []
  const matches: FfufMatch[] = []
  for (const raw of document.results) {
    if (typeof raw !== 'object' || raw === null) continue
    const record = raw as Record<string, unknown>
    const input = record.input
    const fuzz = input !== null && typeof input === 'object' ? (input as Record<string, unknown>).FUZZ : undefined
    const match: { -readonly [K in keyof FfufMatch]?: FfufMatch[K] } = {}
    if (typeof fuzz === 'string' && fuzz.length > 0) match.keyword = fuzz
    if (typeof record.url === 'string' && record.url.length > 0) match.url = record.url
    if (typeof record.status === 'number') match.status = record.status
    if (typeof record.length === 'number') match.length = record.length
    if (typeof record.words === 'number') match.words = record.words
    if (typeof record.lines === 'number') match.lines = record.lines
    if (match.url !== undefined || match.keyword !== undefined) matches.push(match)
  }
  return matches
}
