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

/** Validated ESC certificate-request exploitation accepted by {@link buildCertipyReqArgv}. */
export interface CertipyReqRequest {
  /** Fully-qualified domain of the authenticated account. Never starts with `-`. */
  readonly domain: string
  /** Authenticated account name whose resolved password performs the request. */
  readonly username: string
  /** Secret resolved from `credential_ref` by the tool wrapper; never a model-visible value. */
  readonly password: string
  /** Environment-variable-shaped credential reference the caller presented. */
  readonly credentialRef: string
  /** Certificate authority name to request from, as `adcs_find` reported it. */
  readonly ca: string
  /** Certificate template name to request, as `adcs_find` reported it. */
  readonly template: string
  /** `-dc-ip` domain controller address. */
  readonly dcIp?: string
  /** Subject Alternative Name to embed (ESC1 SAN specification). */
  readonly san?: string
}

const CA_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._\-]*$/

function validateCaName(ca: string): string {
  const trimmed = ca.trim()
  if (trimmed.length === 0 || trimmed.length > 128 || trimmed.startsWith('-') || !CA_NAME_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-certipy: invalid CA name ${JSON.stringify(ca)}`)
  }
  return trimmed
}

function validateTemplate(template: string): string {
  const trimmed = template.trim()
  if (trimmed.length === 0 || trimmed.length > 128 || trimmed.startsWith('-') || !CA_NAME_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-certipy: invalid template name ${JSON.stringify(template)}`)
  }
  return trimmed
}

function validateSan(san: string): string {
  const trimmed = san.trim()
  if (trimmed.length === 0 || trimmed.length > 256 || trimmed.startsWith('-') || !/^[A-Za-z0-9._\-@*]+$/.test(trimmed)) {
    throw new TypeError(`tool-certipy: invalid SAN ${JSON.stringify(san)}`)
  }
  return trimmed
}

/**
 * Build the certipy req argv for one ESC-path certificate request. The
 * resulting PFX file is a mechanism artifact (binary certificate), not a
 * tool-result export: it writes into a wrapper-chosen private directory and
 * the result carries the path plus the stdout summary. The secret rides on
 * the `-p` flag as with find, never in model-visible arguments.
 * @param certipyPath - resolved certipy executable path.
 * @param request - validated exploitation request.
 * @param pfxPath - absolute output path for the PFX artifact.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildCertipyReqArgv(certipyPath: string, request: CertipyReqRequest, pfxPath: string): string[] {
  const domain = validateDomain(request.domain)
  const username = validateUsername(request.username)
  validateCredentialRef(request.credentialRef)
  if (!pfxPath.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(pfxPath)) {
    throw new TypeError('tool-certipy: pfxPath must be absolute')
  }
  const argv: string[] = [
    certipyPath, 'req', '-u', `${username}@${domain}`, '-p', request.password,
    '-ca', validateCaName(request.ca), '-template', validateTemplate(request.template),
    '-out', pfxPath,
  ]
  if (request.dcIp !== undefined) argv.push('-dc-ip', validateHost(request.dcIp))
  if (request.san !== undefined) argv.push('-san', validateSan(request.san))
  return argv
}

/** Validated certificate-authentication request accepted by {@link buildCertipyAuthArgv}. */
export interface CertifyAuthRequest {
  /** PFX artifact path as `adcs_req` reported it. */
  readonly pfxPath: string
  /** `-dc-ip` domain controller address. */
  readonly dcIp?: string
}

/**
 * Build the certipy auth argv: authenticate with one PFX artifact and print
 * the resulting TGT or hash information to stdout (text output the tool
 * parses; no output-file arguments).
 * @param certipyPath - resolved certipy executable path.
 * @param request - validated authentication request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildCertipyAuthArgv(certipyPath: string, request: CertifyAuthRequest): string[] {
  if (!request.pfxPath.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(request.pfxPath)) {
    throw new TypeError('tool-certipy: pfxPath must be absolute')
  }
  const argv: string[] = [certipyPath, 'auth', '-pfx', request.pfxPath]
  if (request.dcIp !== undefined) argv.push('-dc-ip', validateHost(request.dcIp))
  return argv
}

/** One summary line of certipy req or auth stdout. */
export interface CertipyLine {
  /** Non-empty output line as certipy printed it. */
  readonly text: string
}


/**
 * Parse certipy req/auth stdout into the non-empty output lines, bounded to
 * the last forty lines.
 * @param stdout - complete stdout text.
 * @returns parsed summary lines in output order.
 */
export function parseCertipyLines(stdout: string): readonly CertipyLine[] {
  const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)
  return lines.slice(-40).map(text => ({ text }))
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
