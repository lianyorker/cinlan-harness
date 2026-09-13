/** Constructors for vulnerability knowledge base opaque identifiers. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque CVE id (e.g., CVE-2024-12345). */
export type CveId = Branded<'CveId'>

/** Opaque provider identity used for runtime selection. */
export type VulnKbProviderId = Branded<'VulnKbProviderId'>

/**
 * Brand a validated CVE identifier at the input boundary.
 * @param value - Validated canonical CVE identifier.
 * @returns Opaque CVE identifier.
 */
export function CveId(value: string): CveId {
  return value as CveId
}

/**
 * Brand a provider identity after configuration or registration validation.
 * @param value - Validated provider identity.
 * @returns Opaque provider identity.
 */
export function VulnKbProviderId(value: string): VulnKbProviderId {
  return value as VulnKbProviderId
}
