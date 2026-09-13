/**
 * Vulnerability knowledge base domain types: query, result, and error vocabulary.
 * Free of Cordis and provider imports so client and wire programs can name them
 * without the root's Context merge.
 *
 * @module @deepseek-ai/dsh-vuln-kb-service/types
 */

import type { CveId } from './brand.ts'

export type { CveId, VulnKbProviderId } from './brand.ts'

/** Severity levels used by CVSS v3.x and v4.x providers. */
export type VulnSeverity = 'critical' | 'high' | 'medium' | 'low' | 'unknown'

/** A single vulnerability reference URL. */
export interface VulnReference {
  /** Source label (e.g., NVD, OSV, vendor advisory). */
  source: string
  /** URL to the advisory or description. */
  url: string
}

/** A single affected package/version range. */
export interface VulnAffectedRange {
  /** Package ecosystem (e.g., npm, pypi, maven, go, nuget). */
  ecosystem: string
  /** Package name within the ecosystem. */
  package: string
  /** Source range scheme, when the provider exposes one. */
  rangeType: 'semver' | 'ecosystem' | 'git' | 'cpe' | 'versions'
  /** Introduced version (inclusive), or empty string for "from the beginning". */
  introduced?: string
  /** Whether the introduced bound includes the named version. Defaults to true. */
  introducedInclusive?: boolean
  /** First unaffected version, so the affected interval ends immediately before it. */
  fixed?: string
  /** Last affected version (inclusive), used when no fix is known. */
  lastAffected?: string
  /** Upper limit supplied by a provider, such as an OSV GIT range limit. */
  limit?: string
  /** Discrete affected versions when the provider does not define a range. */
  versions?: readonly string[]
}

/** A vulnerability knowledge base entry. */
export interface VulnEntry {
  /** CVE id or OSV id. */
  id: string
  /** Source database (nvd, osv, github). */
  source: string
  /** One-line summary. */
  summary: string
  /** Detailed description (may be truncated). */
  description: string
  /** CVSS v3.x severity rating. */
  severity: VulnSeverity
  /** CVSS vector string if available. */
  cvssVector?: string
  /** Published date (ISO 8601). */
  published?: string
  /** Last modified date (ISO 8601). */
  modified?: string
  /** Affected package/version ranges. */
  affected: readonly VulnAffectedRange[]
  /** Reference URLs. */
  references: readonly VulnReference[]
  /** Whether the vulnerability has a known fix. */
  hasFix: boolean
}

/** Query request for the vulnerability knowledge base. */
export interface VulnQueryRequest {
  /** CVE id (e.g., CVE-2024-12345). */
  cveId?: CveId
  /** Package ecosystem (e.g., npm, pypi). */
  ecosystem?: string
  /** Package name within the ecosystem. */
  package?: string
  /** Specific version to check for affectedness. */
  version?: string
  /** Maximum number of results to return. */
  maxResults?: number
}

/** Query result containing matching vulnerability entries. */
export interface VulnQueryResult {
  /** Matching vulnerability entries. */
  entries: readonly VulnEntry[]
  /** Total matches found (may exceed entries.length if maxResults was applied). */
  total: number
  /** Whether the result set was truncated. */
  truncated: boolean
}

/** Expected failure classes for vulnerability KB operations. */
export type VulnKbErrorCode =
  | 'not_found'
  | 'invalid_query'
  | 'query_failed'
  | 'unavailable'

/**
 * Classified vulnerability KB failure suitable for a direct human-command result
 * or model tool error.
 */
export class VulnKbError extends Error {
  override readonly name = 'VulnKbError'

  constructor(
    readonly code: VulnKbErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}
