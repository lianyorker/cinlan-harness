/**
 * impacket-GetNPUsers argv construction and AS-REP Roasting hash output
 * parsing. Pure functions so the tool wrapper stays thin and the parser is
 * unit-testable without impacket.
 *
 * @module @cinlan/tool-impacket/asreproast
 */

import { validateCredentialRef, validateDomain, validateHost, validateUsername } from './validate.ts'

/** Validated AS-REP Roasting request accepted by {@link buildAsrepRoastArgv}. */
export interface AsrepRoastRequest {
  /** Fully-qualified domain the accounts live in. Never starts with `-`. */
  readonly domain: string
  /** Authenticated account name whose resolved password performs the enumeration. */
  readonly username: string
  /** Secret resolved from `credential_ref` by the tool wrapper; never a model-visible value. */
  readonly password: string
  /** `-dc-ip` domain controller address. */
  readonly dcIp?: string
  /** Environment-variable-shaped credential reference the caller presented. */
  readonly credentialRef: string
}

/**
 * Build the impacket-GetNPUsers argv for one authenticated AS-REP Roasting
 * request. Enumeration requires the authenticated account; user-list file
 * arguments are never emitted. Output is always hashcat-format hash lines on
 * stdout (`-request -outputformat hashcat`).
 * @param asrepPath - resolved impacket-GetNPUsers executable path.
 * @param request - validated request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildAsrepRoastArgv(asrepPath: string, request: AsrepRoastRequest): string[] {
  const domain = validateDomain(request.domain)
  const username = validateUsername(request.username)
  validateCredentialRef(request.credentialRef)
  const argv: string[] = [asrepPath, '-request', '-outputformat', 'hashcat']
  if (request.dcIp !== undefined) argv.push('-dc-ip', validateHost(request.dcIp))
  argv.push(`${domain}/${username}:${request.password}`)
  return argv
}

/** One extracted AS-REP Roasting hash row. */
export interface AsrepRoastRow {
  /** Account the hash belongs to, when the line carries it. */
  readonly account?: string
  /** Complete `$krb5asrep$` hash line. */
  readonly hash: string
}

/**
 * Parse impacket-GetNPUsers stdout: hash lines start with `$krb5asrep$` in
 * both john and hashcat shapes; other lines are skipped.
 * @param stdout - complete stdout text.
 * @returns extracted hash rows in output order.
 */
export function parseAsrepRoastHashes(stdout: string): readonly AsrepRoastRow[] {
  const rows: AsrepRoastRow[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('$krb5asrep$')) continue
    const account = /\$krb5asrep\$23\$\*?([^$]+)\$/.exec(trimmed)?.[1]
    rows.push(account === undefined ? { hash: trimmed } : { account, hash: trimmed })
  }
  return rows
}
