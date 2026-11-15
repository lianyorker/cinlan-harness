/**
 * certipy find argv construction and ADCS JSON output parsing. Pure functions
 * so the tool wrapper stays thin and the parser is unit-testable without
 * certipy.
 *
 * @module @cinlan/tool-certipy/certipy
 */

/** Validated ADCS collection request accepted by {@link buildCertipyFindArgv}. */
export interface CertipyFindRequest {
  /** Fully-qualified domain of the authenticated account. Never starts with `-`. */
  readonly domain: string
  /** Authenticated account name whose resolved password performs the collection. */
  readonly username: string
  /** Secret resolved from `credential_ref` by the tool wrapper; never a model-visible value. */
  readonly password: string
  /** `-dc-ip` domain controller address. */
  readonly dcIp?: string
  /** `-vulnerable` — report only certificate authorities and templates with known escalation paths. */
  readonly vulnerableOnly?: boolean
  /** Environment-variable-shaped credential reference the caller presented. */
  readonly credentialRef: string
}

const MAX_DOMAIN_LENGTH = 253
const DOMAIN_PATTERN = /^[A-Za-z0-9._\-]+$/
const USERNAME_PATTERN = /^[A-Za-z0-9._@\-]+$/
const HOST_PATTERN = /^[A-Za-z0-9.:]+$/
const REF_SEGMENT_PATTERN = /^[A-Za-z0-9._\-]+$/

function validateDomain(domain: string): string {
  const trimmed = domain.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_DOMAIN_LENGTH || trimmed.startsWith('-')) {
    throw new TypeError(`tool-certipy: invalid domain ${JSON.stringify(domain)}`)
  }
  if (!DOMAIN_PATTERN.test(trimmed) || !trimmed.includes('.')) {
    throw new TypeError(`tool-certipy: domain contains unsupported characters or is not a DNS name ${JSON.stringify(domain)}`)
  }
  return trimmed
}

function validateUsername(username: string): string {
  const trimmed = username.trim()
  if (trimmed.length === 0 || trimmed.length > 256 || trimmed.startsWith('-')) {
    throw new TypeError(`tool-certipy: invalid username ${JSON.stringify(username)}`)
  }
  if (!USERNAME_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-certipy: username contains unsupported characters ${JSON.stringify(username)}`)
  }
  return trimmed
}

function validateHost(host: string): string {
  const trimmed = host.trim()
  if (trimmed.length === 0 || trimmed.length > 45 || trimmed.startsWith('-')) {
    throw new TypeError(`tool-certipy: invalid dc_ip ${JSON.stringify(host)}`)
  }
  if (!HOST_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-certipy: dc_ip contains unsupported characters ${JSON.stringify(host)}`)
  }
  return trimmed
}

function validateCredentialRef(ref: string): string {
  const trimmed = ref.trim()
  if (trimmed.length === 0 || trimmed.length > 64 || trimmed.startsWith('-')) {
    throw new TypeError(`tool-certipy: invalid credential_ref ${JSON.stringify(ref)}`)
  }
  if (!REF_SEGMENT_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-certipy: credential_ref contains unsupported characters ${JSON.stringify(ref)}`)
  }
  return trimmed
}

/**
 * Build the certipy find argv for one authenticated ADCS collection. Output
 * is always JSON on stdout (`-stdout`); no output-file arguments are ever
 * emitted, and the secret rides on the `-p` flag and never appears in
 * model-visible arguments or the Session log.
 * @param certipyPath - resolved certipy executable path.
 * @param request - validated collection request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildCertipyFindArgv(certipyPath: string, request: CertipyFindRequest): string[] {
  const domain = validateDomain(request.domain)
  const username = validateUsername(request.username)
  validateCredentialRef(request.credentialRef)
  const argv: string[] = [
    certipyPath, 'find', '-u', `${username}@${domain}`, '-p', request.password, '-stdout',
  ]
  if (request.dcIp !== undefined) argv.push('-dc-ip', validateHost(request.dcIp))
  if (request.vulnerableOnly === true) argv.push('-vulnerable')
  return argv
}

/** One named ADCS row (certificate authority or template). */
export interface CertipyRow {
  /** Row name as certipy reported it. */
  readonly name: string
}

/**
 * Parse certipy `find -stdout` JSON: a `{"CAs": [...], "Templates": [...]}`
 * document. Both list fields tolerate absent or non-array shapes; row names
 * fall back to any non-empty `name` property and rows without one are
 * skipped.
 * @param stdout - complete stdout text.
 * @returns parsed certificate-authority and template rows.
 */
export function parseCertipyFind(stdout: string): { cas: readonly CertipyRow[]; templates: readonly CertipyRow[] } {
  const empty = { cas: [] as CertipyRow[], templates: [] as CertipyRow[] }
  const trimmed = stdout.trim()
  if (trimmed.length === 0) return empty
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return empty
  }
  if (typeof parsed !== 'object' || parsed === null) return empty
  const record = parsed as Record<string, unknown>
  const rowsOf = (key: string): CertipyRow[] => {
    const value = record[key]
    if (!Array.isArray(value)) return []
    const rows: CertipyRow[] = []
    for (const entry of value) {
      const name = typeof entry === 'object' && entry !== null && 'name' in entry
        ? (entry as { name?: unknown }).name
        : undefined
      if (typeof name === 'string' && name.length > 0) rows.push({ name })
    }
    return rows
  }
  return { cas: rowsOf('CAs'), templates: rowsOf('Templates') }
}
