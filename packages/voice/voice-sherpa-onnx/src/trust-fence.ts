/**
 * Loopback-only trust fence for the /voice/api route, behaviorally identical
 * to the loopback check in @deepseek-ai/dsh-client-connection's
 * loopback-hostname.ts (BSD-3-Clause, copied here because that package does
 * not export the helper and this plugin must not depend on its internals —
 * the same precedent @deepseek-ai/dsh-client-ui-better-sidebar's
 * trust-fence.ts follows). This route accepts only same-origin/loopback
 * requests; it is a DNS-rebinding / cross-site defense, not authentication.
 */
import type { IncomingHttpHeaders } from 'node:http'

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function parseAuthority(authority: string): URL | undefined {
  try {
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/**
 * Test whether a normalized URL hostname names local loopback.
 * @param hostname - normalized URL hostname without a port.
 * @returns true for localhost, IPv6 loopback, or an IPv4 127/8 address.
 */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * Decide whether one /voice/api request may reach the route.
 * @param headers - the incoming request's headers.
 * @returns true when the Host authority is loopback and browser markers are same-origin.
 */
export function isTrustedVoiceApiRequest(headers: IncomingHttpHeaders): boolean {
  const host = header(headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname)) return false
  if (header(headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}
