/**
 * gau argv construction and mixed-line output parsing. Pure functions so the
 * tool wrapper stays thin and the parser is unit-testable without gau.
 *
 * @module @cinlan/tool-gau/gau
 */

/** Validated fetch request accepted by {@link buildGauArgv}. */
export interface GauUrlsRequest {
  /** Root domain to fetch known URLs for. Never starts with `-`. */
  readonly domain: string
  /** Restrict passive sources via `--providers`; omit for the tool default (all sources). */
  readonly providers?: readonly string[]
}

/** Passive data sources this tool may request. */
export const GAU_PROVIDERS: readonly string[] = ['wayback', 'commoncrawl', 'otx', 'urlscan']

const MAX_DOMAIN_LENGTH = 253
const DOMAIN_PATTERN = /^[A-Za-z0-9._\-*]+$/

function validateDomain(domain: string): string {
  const trimmed = domain.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_DOMAIN_LENGTH || trimmed.startsWith('-')) {
    throw new TypeError(`tool-gau: invalid domain ${JSON.stringify(domain)}`)
  }
  if (!DOMAIN_PATTERN.test(trimmed) || !trimmed.includes('.')) {
    throw new TypeError(`tool-gau: domain contains unsupported characters or is not a DNS name ${JSON.stringify(domain)}`)
  }
  return trimmed
}

/**
 * Build the gau argv for one passive historical-URL fetch. The run is fully
 * passive: gau queries third-party archives (wayback, commoncrawl, otx,
 * urlscan) and never contacts the target domain itself. `--json` and `--subs`
 * are fixed; no output-file arguments are ever emitted.
 * @param gauPath - resolved gau executable path.
 * @param request - validated fetch request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildGauArgv(gauPath: string, request: GauUrlsRequest): string[] {
  const domain = validateDomain(request.domain)
  const argv: string[] = [gauPath, '--json', '--subs']
  if (request.providers !== undefined) {
    if (!Array.isArray(request.providers) || request.providers.length === 0) {
      throw new TypeError('tool-gau: providers must be a non-empty list when provided')
    }
    for (const provider of request.providers) {
      if (!GAU_PROVIDERS.includes(provider)) {
        throw new TypeError(`tool-gau: unsupported provider ${JSON.stringify(provider)}; allowed: ${GAU_PROVIDERS.join(', ')}`)
      }
    }
    argv.push('--providers', request.providers.join(','))
  }
  argv.push(domain)
  return argv
}

/**
 * Parse gau stdout. Depending on the installed gau version, `--json` yields
 * one JSON object per line (the URL in its `url` field) or plain URL lines;
 * both shapes are accepted and results are deduplicated in output order.
 * @param stdout - complete stdout text.
 * @returns deduplicated URL strings in first-seen order.
 */
export function parseGauLines(stdout: string): string[] {
  const urls: string[] = []
  const seen = new Set<string>()
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let url: string | undefined
    if (trimmed.startsWith('{')) {
      try {
        const record = JSON.parse(trimmed) as Record<string, unknown>
        url = typeof record.url === 'string' && record.url.length > 0 ? record.url : undefined
      } catch {
        url = undefined
      }
    } else {
      url = trimmed
    }
    if (url === undefined || seen.has(url)) continue
    seen.add(url)
    urls.push(url)
  }
  return urls
}
