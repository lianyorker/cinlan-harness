/**
 * subfinder argv construction and `-json` line parsing. Pure functions so the
 * tool wrapper stays thin and the parser is unit-testable without subfinder.
 *
 * @module @cinlan/tool-subfinder/subfinder
 */

/** Validated enumeration request accepted by {@link buildSubfinderArgv}. */
export interface SubfinderEnumRequest {
  /** Root domain to enumerate subdomains for. Never starts with `-`. */
  readonly domain: string
  /** Include only subdomains whose host resolves (`-resolve`). */
  readonly resolve?: boolean
  /** `-active` — display only resolved and active hosts (implies resolve behavior upstream). */
  readonly active?: boolean
}

const MAX_DOMAIN_LENGTH = 253
const DOMAIN_PATTERN = /^[A-Za-z0-9._\-*]+$/

function validateDomain(domain: string): string {
  const trimmed = domain.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_DOMAIN_LENGTH || trimmed.startsWith('-')) {
    throw new TypeError(`tool-subfinder: invalid domain ${JSON.stringify(domain)}`)
  }
  if (!DOMAIN_PATTERN.test(trimmed) || !trimmed.includes('.')) {
    throw new TypeError(`tool-subfinder: domain contains unsupported characters or is not a DNS name ${JSON.stringify(domain)}`)
  }
  return trimmed
}

/**
 * Build the subfinder argv for one passive enumeration run. Output is always
 * one JSON object per line on stdout (`-json`); the run is fully passive —
 * no direct probes of the target are emitted by this tool.
 * @param subfinderPath - resolved subfinder executable path.
 * @param request - validated enumeration request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildSubfinderArgv(subfinderPath: string, request: SubfinderEnumRequest): string[] {
  const domain = validateDomain(request.domain)
  const argv: string[] = [subfinderPath, '-json', '-domain', domain]
  if (request.resolve === true) argv.push('-resolve')
  if (request.active === true) argv.push('-active')
  return argv
}

/** One enumerated subdomain row from subfinder `-json` output. */
export interface SubfinderResult {
  /** Discovered subdomain hostname. */
  readonly host: string
  /** Source that reported the subdomain (passive data source name). */
  readonly source?: string
  /** Resolved IPv4/IPv6 addresses when `-resolve` is on. */
  readonly addrs?: readonly string[]
}

/**
 * Parse subfinder `-json` stdout: one JSON object per line; unparseable lines
 * are skipped rather than failing the whole run.
 * @param stdout - complete stdout text.
 * @returns parsed subdomain rows in output order.
 */
export function parseSubfinderJsonLines(stdout: string): readonly SubfinderResult[] {
  const results: SubfinderResult[] = []
  const seen = new Set<string>()
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || !trimmed.startsWith('{')) continue
    let record: Record<string, unknown>
    try {
      record = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }
    const host = record.host
    if (typeof host !== 'string' || host.length === 0) continue
    if (seen.has(host)) continue
    seen.add(host)
    const result: { host: string; source?: string; addrs?: string[] } = { host }
    if (typeof record.source === 'string' && record.source.length > 0) result.source = record.source
    if (Array.isArray(record.a)) {
      const a = record.a.filter((v): v is string => typeof v === 'string' && v.length > 0)
      if (a.length > 0) result.addrs = a
    }
    if (result.addrs === undefined && Array.isArray(record.aaaa)) {
      const aaaa = record.aaaa.filter((v): v is string => typeof v === 'string' && v.length > 0)
      if (aaaa.length > 0) result.addrs = aaaa
    }
    results.push(result)
  }
  return results
}
