/**
 * nxc (NetExec) argv construction and password-spray output parsing. Pure
 * functions so the tool wrapper stays thin and the parser is unit-testable
 * without nxc.
 *
 * @module @cinlan/tool-nxc/nxc
 */

/** Protocols the spray adapter may drive. */
export const NXC_SPRAY_PROTOCOLS: readonly string[] = ['smb', 'ldap', 'mssql', 'winrm', 'ssh']

/** Validated spray request accepted by {@link buildNxcSprayArgv}. */
export interface NxcSprayRequest {
  /** Target host the spray runs against. Never starts with `-`. */
  readonly target: string
  /** Candidate account names to try with the resolved secret. */
  readonly usernames: readonly string[]
  /** Secret resolved from `credential_ref` by the tool wrapper; never a model-visible value. */
  readonly password: string
  /** Protocol subcommand; one of {@link NXC_SPRAY_PROTOCOLS}. Default `smb`. */
  readonly protocol?: string
  /** `-d` fully-qualified domain for domain-qualified sprays. */
  readonly domain?: string
  /** `--threads` parallel worker count, bounded by the deployment cap. */
  readonly threads?: number
  /** Environment-variable-shaped credential reference the caller presented. */
  readonly credentialRef: string
}

/** Deployment-side maximum for the model-selected `--threads`. */
export const MAX_THREADS_ABSOLUTE = 100
const DEFAULT_THREADS = 5

const MAX_TARGET_LENGTH = 253
const TARGET_PATTERN = /^[A-Za-z0-9._:\-]+$/
const USERNAME_PATTERN = /^[A-Za-z0-9._@\-]+$/
const DOMAIN_PATTERN = /^[A-Za-z0-9._\-]+$/
const REF_SEGMENT_PATTERN = /^[A-Za-z0-9._\-]+$/

function validateTarget(target: string): string {
  const trimmed = target.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_TARGET_LENGTH || trimmed.startsWith('-')) {
    throw new TypeError(`tool-nxc: invalid spray target ${JSON.stringify(target)}`)
  }
  if (!TARGET_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-nxc: spray target contains unsupported characters ${JSON.stringify(target)}`)
  }
  return trimmed
}

function validateUsernames(usernames: readonly string[]): string[] {
  if (!Array.isArray(usernames) || usernames.length === 0 || usernames.length > 100) {
    throw new TypeError('tool-nxc: usernames must be a list of 1 to 100 account names')
  }
  const cleaned = usernames.map(name => name.trim())
  for (const name of cleaned) {
    if (name.length === 0 || name.length > 256 || name.startsWith('-') || !USERNAME_PATTERN.test(name)) {
      throw new TypeError(`tool-nxc: invalid username entry ${JSON.stringify(name)}`)
    }
  }
  if (new Set(cleaned).size !== cleaned.length) {
    throw new TypeError('tool-nxc: usernames must not contain duplicates')
  }
  return cleaned
}

/**
 * Build the nxc argv for one password spray. `--continue-on-success` and
 * `--no-banner` are fixed; the secret rides on the `-p` flag and never
 * appears in tool arguments or the Session log. No output-file arguments
 * are ever emitted.
 * @param nxcPath - resolved nxc executable path.
 * @param request - validated spray request.
 * @param maxThreads - deployment thread cap; the requested count may not exceed it.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildNxcSprayArgv(nxcPath: string, request: NxcSprayRequest, maxThreads: number): string[] {
  if (!Number.isSafeInteger(maxThreads) || maxThreads < 1 || maxThreads > MAX_THREADS_ABSOLUTE) {
    throw new TypeError(`tool-nxc: maxThreads must be an integer between 1 and ${MAX_THREADS_ABSOLUTE}`)
  }
  const protocol = request.protocol ?? 'smb'
  if (!NXC_SPRAY_PROTOCOLS.includes(protocol)) {
    throw new TypeError(`tool-nxc: unsupported protocol ${JSON.stringify(protocol)}`)
  }
  const target = validateTarget(request.target)
  const usernames = validateUsernames(request.usernames)
  const ref = request.credentialRef.trim()
  if (ref.length === 0 || ref.length > 64 || ref.startsWith('-') || !REF_SEGMENT_PATTERN.test(ref)) {
    throw new TypeError(`tool-nxc: invalid credential_ref ${JSON.stringify(request.credentialRef)}`)
  }
  const argv: string[] = [nxcPath, protocol, target, '-u', usernames.join(','), '-p', request.password]
  if (request.domain !== undefined) {
    const domain = request.domain.trim()
    if (domain.length === 0 || domain.length > 253 || domain.startsWith('-')
      || !DOMAIN_PATTERN.test(domain) || !domain.includes('.')) {
      throw new TypeError(`tool-nxc: invalid domain ${JSON.stringify(request.domain)}`)
    }
    argv.push('-d', domain)
  }
  const threads = request.threads ?? DEFAULT_THREADS
  if (!Number.isSafeInteger(threads) || threads < 1 || threads > maxThreads) {
    throw new TypeError(`tool-nxc: threads must be an integer between 1 and ${maxThreads}`)
  }
  argv.push('--threads', String(threads), '--continue-on-success', '--no-banner')
  return argv
}

/** One credential spray hit. */
export interface NxcSprayHit {
  /** Account name parsed from the hit line, when present. */
  readonly user?: string
  /** Raw hit line (the secret is never part of it). */
  readonly line: string
}

/** Parsed spray outcome. */
export interface NxcSprayResult {
  /** Lines reporting a successful credential match. */
  readonly hits: readonly NxcSprayHit[]
  /** Number of failed attempts nxc reported. */
  readonly failures: number
}

/**
 * Parse nxc spray stdout: hit lines carry `[+]`, failure lines `[-]`; hit
 * account names are extracted after the marker when the line matches the
 * common `user:` or `domain\user:` shapes. nxc echoes the secret inside hit
 * lines, so every occurrence of each redaction string is replaced before a
 * line is stored.
 * @param stdout - complete stdout text.
 * @param redactions - secret values to scrub from every stored line.
 * @returns parsed spray outcome.
 */
export function parseNxcSprayLines(stdout: string, redactions: readonly string[] = []): NxcSprayResult {
  const hits: NxcSprayHit[] = []
  let failures = 0
  const scrub = (line: string): string => {
    let result = line
    for (const secret of redactions) {
      if (secret.length > 0) result = result.split(secret).join('[redacted]')
    }
    return result
  }
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    if (trimmed.includes('[-]')) {
      failures += 1
      continue
    }
    if (!trimmed.includes('[+]')) continue
    const scrubbed = scrub(trimmed)
    const user = /\[\+\][^A-Za-z0-9._@\\-]*(?:[A-Za-z0-9._@-]+\\)?([A-Za-z0-9._@-]+):/.exec(scrubbed)?.[1]
    hits.push(user === undefined ? { line: scrubbed } : { user, line: scrubbed })
  }
  return { hits, failures }
}
