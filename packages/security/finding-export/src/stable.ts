/** Stable deterministic exporter helpers for finding reports. */

import type { FindingSnapshot } from '@deepseek-ai/dsh-finding'

/**
 * Sort findings by stable compound key for deterministic output.
 * @param findings - findings to sort.
 * @returns sorted copy in deterministic order.
 */
export function stableFindings(findings: readonly FindingSnapshot[]): readonly FindingSnapshot[] {
  return [...findings].sort((a, b) => {
    // Primary: severity (high to low)
    const severityOrder: Record<FindingSnapshot['severity'], number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
      informational: 4,
    }
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity]
    if (sevDiff !== 0) return sevDiff

    // Secondary: state (reproduced, hypothesis, observation, remediation, unresolved)
    const stateOrder: Record<FindingSnapshot['state'], number> = {
      'reproduced-vulnerability': 0,
      hypothesis: 1,
      observation: 2,
      remediation: 3,
      unresolved: 4,
    }
    const stateDiff = stateOrder[a.state] - stateOrder[b.state]
    if (stateDiff !== 0) return stateDiff

    // Tertiary: id (lexicographic)
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/**
 * Deterministic string representation for fingerprint computation.
 * @param finding - finding to fingerprint.
 * @returns stable string.
 */
export function stableFindingKey(finding: FindingSnapshot): string {
  return [
    finding.ruleId,
    finding.targets.map(t => t.id).sort().join(','),
    finding.locations
      .map(loc =>
        loc.kind === 'code'
          ? `code:${loc.uri}:${loc.startLine ?? ''}:${loc.startColumn ?? ''}`
          : `dep:${loc.ecosystem}:${loc.packageName}:${loc.version ?? ''}`,
      )
      .sort()
      .join('|'),
  ].join('::')
}


/**
 * Compute deterministic export timestamp from findings.
 * @param findings - findings to compute timestamp from.
 * @returns ISO timestamp of most recent finding update, or the Unix epoch for an empty report.
 */
export function exportTimestamp(findings: readonly FindingSnapshot[]): string {
  if (findings.length === 0) return new Date(0).toISOString()
  const latest = Math.max(...findings.map(f => f.updatedAt))
  return new Date(latest).toISOString()
}

/**
 * Encode JSON document as deterministic UTF-8 bytes.
 * @param doc - JSON-serializable document.
 * @returns UTF-8 encoded bytes with stable formatting.
 */
export function stableJsonDocument(doc: unknown): Uint8Array {
  const json = JSON.stringify(doc, null, 2)
  return new TextEncoder().encode(json)
}

/**
 * Encode UTF-8 string document as bytes.
 * @param text - UTF-8 text content.
 * @returns UTF-8 encoded bytes.
 */
export function utf8Document(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}
