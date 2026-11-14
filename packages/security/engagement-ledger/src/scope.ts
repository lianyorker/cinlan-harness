/**
 * Host ↔ assessment-grant matching for the engagement ledger. Reimplements
 * the `targetFor` convention from `dsh-assessment-scope-tool-policy` (exact
 * value, or `url-prefix` containment) and adds `*.` hostname suffixes and
 * IPv4 CIDR entries so scope lines like `10.0.0.0/8` behave the way operators
 * expect. Ledger writes consult the *live* root grant every time.
 *
 * @module @cinlan/engagement-ledger/scope
 */

import type { AssessmentGrant, AssessmentTarget } from '@deepseek-ai/dsh-assessment-scope'

/** Normalize an asset host for scope comparisons. */
export function normalizeLedgerHost(raw: unknown): string {
  let host = String(raw ?? '').trim().toLowerCase()
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  host = host.split('/')[0] ?? ''
  const bracketed = /^\[([0-9a-f:]+)\](?::\d+)?$/.exec(host)
  if (bracketed) {
    host = bracketed[1] ?? ''
  } else if (/^[a-z0-9.-]+:\d+$/.test(host)) {
    host = host.slice(0, host.lastIndexOf(':'))
  }
  host = host.replace(/\.$/, '')
  if (!host) throw new TypeError('engagement-ledger: host must be non-empty')
  if (host.length > 253) throw new TypeError('engagement-ledger: host exceeds 253 characters')
  return host
}

function isIpv4(host: string): boolean {
  const parts = host.split('.')
  return parts.length === 4 && parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

/** IPv4 `a.b.c.d/n` containment; returns false for non-CIDR or IPv6 targets. */
export function cidrContains(cidr: string, host: string): boolean {
  const slash = cidr.indexOf('/')
  if (slash < 0) return false
  const base = cidr.slice(0, slash)
  const bits = Number(cidr.slice(slash + 1))
  if (!isIpv4(base) || !isIpv4(host) || !Number.isInteger(bits) || bits < 0 || bits > 32) return false
  const toInt = (ip: string) => ip.split('.').reduce((acc, p) => (acc << 8) | Number(p), 0) >>> 0
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (toInt(base) & mask) === (toInt(host) & mask)
}

function hostnameMatches(pattern: string, host: string): boolean {
  if (pattern === host) return true
  const suffix = pattern.startsWith('*.') ? pattern.slice(1) : '.' + pattern
  return host.endsWith(suffix) && host.length > suffix.length
}

function urlPrefixHostname(value: string): string | undefined {
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    return url.hostname.toLowerCase()
  } catch {
    return undefined
  }
}

/**
 * Whether one declared grant target covers the given host. Mirrors
 * tool-policy matching (exact, url-prefix) plus wildcard-suffix and CIDR.
 * `service`/`artifact-scope` kinds never match a host.
 */
export function targetMatchesHost(target: AssessmentTarget, host: string): boolean {
  const value = target.value.toLowerCase()
  switch (target.kind) {
    case 'hostname':
      return hostnameMatches(value, host) || cidrContains(value, host)
    case 'ip-address':
      return value === host || cidrContains(value, host)
    case 'url-prefix': {
      if (host.toLowerCase().startsWith(value)) return true
      const prefixHost = urlPrefixHostname(value)
      return prefixHost !== undefined && hostnameMatches(prefixHost, host)
    }
    default:
      return false
  }
}

/**
 * Decide whether `host` is admissible under `grant`: it must match at least
 * one non-excluded target. Throws with a stable message when out of scope.
 * @returns The matched target.
 */
export function assertHostInGrant(host: string, grant: AssessmentGrant): AssessmentTarget {
  const excluded = new Set<string>(grant.excludedTargetIds as readonly string[])
  const match = grant.targets.find(target => !excluded.has(target.id) && targetMatchesHost(target, host))
  if (match !== undefined) return match
  const excludedHit = grant.targets.find(target => excluded.has(target.id) && targetMatchesHost(target, host))
  if (excludedHit !== undefined) {
    throw new Error(`engagement-ledger: asset ${host} is inside an excluded scope target (${excludedHit.value})`)
  }
  throw new Error(`engagement-ledger: asset ${host} is outside the authorized scope; add it to the assessment grant first`)
}

/** Snapshot of the grant's target/exclusion values stored on a campaign. */
export function scopeSnapshot(grant: AssessmentGrant): { targets: string[]; excluded: string[] } {
  const excluded = new Set<string>(grant.excludedTargetIds as readonly string[])
  return {
    targets: grant.targets.filter(t => !excluded.has(t.id)).map(t => t.value),
    excluded: grant.targets.filter(t => excluded.has(t.id)).map(t => t.value),
  }
}
