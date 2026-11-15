/**
 * impacket-rbcd argv construction. Pure function so the tool wrapper stays
 * thin and validation is unit-testable without impacket.
 *
 * @module @cinlan/tool-impacket/rbcd
 */

import { validateCredentialRef, validateDomain, validateHost, validateUsername } from './validate.ts'

/** Validated RBCD write request accepted by {@link buildRbcdArgv}. */
export interface RbcdRequest {
  /** Fully-qualified domain of the target machine and the authenticated account. */
  readonly domain: string
  /** Authenticated account name whose resolved password performs the write. */
  readonly username: string
  /** Secret resolved from `credential_ref` by the tool wrapper; never a model-visible value. */
  readonly password: string
  /** Target machine receiving the delegation write (`-delegate-to` side of the attribute). */
  readonly target: string
  /** Account granted delegation on the target (`-delegate-from`). */
  readonly delegateFrom: string
  /** `-dc-ip` domain controller address. */
  readonly dcIp?: string
  /** Environment-variable-shaped credential reference the caller presented. */
  readonly credentialRef: string
}

/**
 * Build the impacket-rbcd argv for one constrained-delegation write. The
 * action is fixed to `write` (granting delegation); no read or remove actions
 * and no output-file arguments are ever emitted.
 * @param rbcdPath - resolved impacket-rbcd executable path.
 * @param request - validated write request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildRbcdArgv(rbcdPath: string, request: RbcdRequest): string[] {
  const domain = validateDomain(request.domain)
  const username = validateUsername(request.username)
  const target = validateHost(request.target)
  const delegateFrom = validateUsername(request.delegateFrom)
  validateCredentialRef(request.credentialRef)
  const argv: string[] = [rbcdPath, '-delegate-from', delegateFrom, '-action', 'write']
  if (request.dcIp !== undefined) argv.push('-dc-ip', validateHost(request.dcIp))
  argv.push(`${domain}/${username}:${request.password}@${target}`)
  return argv
}
