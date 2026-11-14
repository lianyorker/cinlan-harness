/**
 * impacket-GetUserSPNs argv construction and Kerberoasting hash output
 * parsing. Pure functions so the tool wrapper stays thin and the parser is
 * unit-testable without impacket.
 *
 * @module @cinlan/tool-impacket/kerberoast
 */

import { validateCredentialRef, validateDomain, validateHost, validateUsername } from './validate.ts'

/** Validated Kerberoasting request accepted by {@link buildKerberoastArgv}. */
export interface KerberoastRequest {
  /** Fully-qualified domain the accounts live in. Never starts with `-`. */
  readonly domain: string
  /** Authenticated account name whose resolved password performs the request. */
  readonly username: string
  /** Secret resolved from `credential_ref` by the tool wrapper; never a model-visible value. */
  readonly password: string
  /** `-dc-ip` domain controller address. */
  readonly dcIp?: string
  /** Environment-variable-shaped credential reference the caller presented. */
  readonly credentialRef: string
}

/**
 * Build the impacket-GetUserSPNs argv for one authenticated Kerberoasting
 * request. Output is always hashcat-format hash lines on stdout
 * (`-request -outputformat hashcat`); the secret rides in impacket's
 * `domain/user:password` target argument and never appears in tool arguments
 * or the Session log.
 * @param kerberoastPath - resolved impacket-GetUserSPNs executable path.
 * @param request - validated request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildKerberoastArgv(kerberoastPath: string, request: KerberoastRequest): string[] {
  const domain = validateDomain(request.domain)
  const username = validateUsername(request.username)
  validateCredentialRef(request.credentialRef)
  const argv: string[] = [kerberoastPath, '-request', '-outputformat', 'hashcat']
  if (request.dcIp !== undefined) argv.push('-dc-ip', validateHost(request.dcIp))
  argv.push(`${domain}/${username}:${request.password}`)
  return argv
}

/** One extracted Kerberoasting hash row. */
export interface KerberoastRow {
  /** Service account the hash belongs to, when the line carries it. */
  readonly account?: string
  /** Complete `$krb5tgs$` hash line. */
  readonly hash: string
}

/**
 * Parse impacket-GetUserSPNs stdout: hash lines start with `$krb5tgs$` in
 * both john (`$krb5tgs$23$*user$domain$spn*`) and hashcat
 * (`$krb5tgs$23$user$domain$spn`) shapes; other lines are skipped.
 * @param stdout - complete stdout text.
 * @returns extracted hash rows in output order.
 */
export function parseKerberoastHashes(stdout: string): readonly KerberoastRow[] {
  const rows: KerberoastRow[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('$krb5tgs$')) continue
    const account = /\$krb5tgs\$23\$\*?([^$]+)\$/.exec(trimmed)?.[1]
    rows.push(account === undefined ? { hash: trimmed } : { account, hash: trimmed })
  }
  return rows
}
