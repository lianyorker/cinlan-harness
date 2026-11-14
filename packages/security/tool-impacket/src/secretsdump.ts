/**
 * impacket-secretsdump argv construction and hash-row output parsing. Pure
 * functions so the tool wrapper stays thin and the parser is unit-testable
 * without impacket.
 *
 * @module @cinlan/tool-impacket/secretsdump
 */

import { validateCredentialRef, validateDomain, validateHost, validateUsername } from './validate.ts'

/** Validated secrets dump request accepted by {@link buildSecretsDumpArgv}. */
export interface SecretsDumpRequest {
  /** Fully-qualified domain the authenticated account lives in. */
  readonly domain: string
  /** Authenticated account name whose resolved password performs the dump. */
  readonly username: string
  /** Secret resolved from `credential_ref` by the tool wrapper; never a model-visible value. */
  readonly password: string
  /** Target host whose local or directory secrets are dumped. */
  readonly target: string
  /** `-dc-ip` domain controller address, required for directory (DCSync) dumps. */
  readonly dcIp?: string
  /** `-just-dc` — dump domain credentials through DRSUAPI (DCSync) instead of the local registry. */
  readonly justDc?: boolean
  /** Environment-variable-shaped credential reference the caller presented. */
  readonly credentialRef: string
}

/**
 * Build the impacket-secretsdump argv for one authenticated dump request.
 * The secret rides in impacket's `domain/user:password@target` argument and
 * never appears in tool arguments or the Session log. No output-file
 * arguments are ever emitted.
 * @param secretsdumpPath - resolved impacket-secretsdump executable path.
 * @param request - validated request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildSecretsDumpArgv(secretsdumpPath: string, request: SecretsDumpRequest): string[] {
  const domain = validateDomain(request.domain)
  const username = validateUsername(request.username)
  const target = validateHost(request.target)
  validateCredentialRef(request.credentialRef)
  const argv: string[] = [secretsdumpPath]
  if (request.dcIp !== undefined) argv.push('-dc-ip', validateHost(request.dcIp))
  if (request.justDc === true) argv.push('-just-dc')
  argv.push(`${domain}/${username}:${request.password}@${target}`)
  return argv
}

/** One extracted credential row. */
export interface SecretsRow {
  /** Account name as printed by secretsdump. */
  readonly account: string
  /** Relative identifier printed with the account. */
  readonly rid: number
  /** LM hash segment when present. */
  readonly lmHash?: string
  /** NT hash segment. */
  readonly ntHash: string
}

const HASH_ROW = /^([^:\s]+):(\d+):([0-9a-f]*):([0-9a-f]+):::\s*$/

/**
 * Parse impacket-secretsdump stdout: credential rows follow the
 * `account:rid:lmhash:nthash:::` shape; banner and progress lines are
 * skipped.
 * @param stdout - complete stdout text.
 * @returns extracted credential rows in output order.
 */
export function parseSecretsDumpRows(stdout: string): readonly SecretsRow[] {
  const rows: SecretsRow[] = []
  for (const line of stdout.split('\n')) {
    const match = HASH_ROW.exec(line.trim())
    if (match === null) continue
    const account = match[1] ?? ''
    const rid = Number.parseInt(match[2] ?? '', 10)
    if (account.length === 0 || !Number.isSafeInteger(rid)) continue
    const row: { account: string; rid: number; lmHash?: string; ntHash: string } = {
      account,
      rid,
      ntHash: match[4] ?? '',
    }
    const lmHash = match[3] ?? ''
    if (lmHash.length > 0) row.lmHash = lmHash
    rows.push(row)
  }
  return rows
}

/** Redaction strength applied to dumped hashes before they reach the model. */
export type SecretsRedactionLevel = 'full' | 'masked'

/**
 * Apply the configured redaction level: `full` keeps hash values intact so
 * they can feed offline cracking; `masked` replaces every hash value.
 * @param rows - parsed credential rows.
 * @param level - configured redaction strength.
 * @returns rows shaped for the configured redaction level.
 */
export function redactSecretsRows(rows: readonly SecretsRow[], level: SecretsRedactionLevel): readonly SecretsRow[] {
  if (level === 'full') return rows
  return rows.map(row => ({
    account: row.account,
    rid: row.rid,
    ...(row.lmHash !== undefined ? { lmHash: '[redacted]' } : {}),
    ntHash: '[redacted]',
  }))
}
