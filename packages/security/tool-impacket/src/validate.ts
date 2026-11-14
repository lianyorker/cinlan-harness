/**
 * Shared argument validators for the impacket tool adapters. Pure functions so
 * every adapter module stays unit-testable without impacket.
 *
 * @module @cinlan/tool-impacket/validate
 */

const MAX_DOMAIN_LENGTH = 253
const DOMAIN_PATTERN = /^[A-Za-z0-9._\-]+$/
const USERNAME_PATTERN = /^[A-Za-z0-9._@\-]+$/
const HOST_PATTERN = /^[A-Za-z0-9._:\[\]-]+$/
const REF_SEGMENT_PATTERN = /^[A-Za-z0-9._\-]+$/

/** Validate one fully-qualified domain name and return it trimmed. */
export function validateDomain(domain: string): string {
  const trimmed = domain.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_DOMAIN_LENGTH || trimmed.startsWith('-')) {
    throw new TypeError(`tool-impacket: invalid domain ${JSON.stringify(domain)}`)
  }
  if (!DOMAIN_PATTERN.test(trimmed) || !trimmed.includes('.')) {
    throw new TypeError(`tool-impacket: domain contains unsupported characters or is not a DNS name ${JSON.stringify(domain)}`)
  }
  return trimmed
}

/** Validate one account name and return it trimmed. */
export function validateUsername(username: string): string {
  const trimmed = username.trim()
  if (trimmed.length === 0 || trimmed.length > 256 || trimmed.startsWith('-')) {
    throw new TypeError(`tool-impacket: invalid username ${JSON.stringify(username)}`)
  }
  if (!USERNAME_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-impacket: username contains unsupported characters ${JSON.stringify(username)}`)
  }
  return trimmed
}

/** Validate one host name or IP address and return it trimmed. */
export function validateHost(host: string): string {
  const trimmed = host.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_DOMAIN_LENGTH || trimmed.startsWith('-')) {
    throw new TypeError(`tool-impacket: invalid host ${JSON.stringify(host)}`)
  }
  if (!HOST_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-impacket: host contains unsupported characters ${JSON.stringify(host)}`)
  }
  return trimmed
}

/** Validate one credential reference name (env-var grammar) and return it trimmed. */
export function validateCredentialRef(ref: string): string {
  const trimmed = ref.trim()
  if (trimmed.length === 0 || trimmed.length > 64 || trimmed.startsWith('-')) {
    throw new TypeError(`tool-impacket: invalid credential_ref ${JSON.stringify(ref)}`)
  }
  if (!REF_SEGMENT_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-impacket: credential_ref contains unsupported characters ${JSON.stringify(ref)}`)
  }
  return trimmed
}
