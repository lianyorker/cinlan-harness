/**
 * Responder and ntlmrelayx argv construction. Pure functions so the tool
 * wrappers stay thin and validation is unit-testable without the binaries.
 *
 * @module @cinlan/tool-listeners/argv
 */

/** Protocols the relay adapter may target. */
export const RELAY_SCHEMES: readonly string[] = ['smb', 'http', 'ldaps']

/** Validated Responder capture request accepted by {@link buildResponderArgv}. */
export interface ResponderCaptureRequest {
  /** Network interface to poison on (`-I`). Never starts with `-`. */
  readonly interface: string
}

/** Validated ntlmrelayx relay request accepted by {@link buildNtlmRelayArgv}. */
export interface NtlmRelayRequest {
  /** Relay target host; the only outbound destination of the run. Never starts with `-`. */
  readonly target: string
  /** Relay target scheme (`-t`). Default `smb`. */
  readonly scheme?: string
}

const IFACE_PATTERN = /^[A-Za-z0-9._-]{1,15}$/
const TARGET_PATTERN = /^[A-Za-z0-9._:\[\]-]+$/
const MAX_TARGET_LENGTH = 253

/**
 * Build the Responder argv for one poisoning session. `-v` is fixed so
 * captured hash lines stream on stdout; no interface, output-file, or
 * callback arguments beyond `-I` are ever emitted.
 * @param responderPath - resolved Responder executable path.
 * @param request - validated capture request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildResponderArgv(responderPath: string, request: ResponderCaptureRequest): string[] {
  const iface = request.interface.trim()
  if (iface.length === 0 || iface.startsWith('-') || !IFACE_PATTERN.test(iface)) {
    throw new TypeError(`tool-listeners: invalid network interface ${JSON.stringify(request.interface)}`)
  }
  return [responderPath, '-I', iface, '-v']
}

/**
 * Build the ntlmrelayx argv for one relay session. The relay target is the
 * run's only outbound destination and must match an assessment grant target;
 * `-smb2support` is fixed and no callback or interactsh arguments are ever
 * emitted.
 * @param ntlmrelayxPath - resolved ntlmrelayx executable path.
 * @param request - validated relay request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildNtlmRelayArgv(ntlmrelayxPath: string, request: NtlmRelayRequest): string[] {
  const scheme = request.scheme ?? 'smb'
  if (!RELAY_SCHEMES.includes(scheme)) {
    throw new TypeError(`tool-listeners: unsupported relay scheme ${JSON.stringify(request.scheme)}`)
  }
  const target = request.target.trim()
  if (target.length === 0 || target.length > MAX_TARGET_LENGTH || target.startsWith('-')
    || !TARGET_PATTERN.test(target)) {
    throw new TypeError(`tool-listeners: invalid relay target ${JSON.stringify(request.target)}`)
  }
  return [ntlmrelayxPath, '-t', `${scheme}://${target}`, '-smb2support']
}
