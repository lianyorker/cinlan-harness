/** Deterministic SARIF 2.1.0 finding exporter. */

import type { FindingSeverity, FindingSnapshot } from '@deepseek-ai/dsh-finding'
import { stableFindings, stableJsonDocument } from './stable.ts'

/** Map domain severity to SARIF result level. */
function sarifLevel(severity: FindingSeverity): 'error' | 'warning' | 'note' {
  if (severity === 'critical' || severity === 'high') return 'error'
  if (severity === 'medium') return 'warning'
  return 'note'
}

/** Build one SARIF physical location from a code location. */
function physicalLocations(finding: FindingSnapshot): unknown[] {
  return finding.locations.flatMap((location) => {
    if (location.kind !== 'code') return []
    return [{
      physicalLocation: {
        artifactLocation: { uri: location.uri },
        ...location.startLine === undefined
          ? {}
          : {
            region: {
              startLine: location.startLine,
              ...location.startColumn === undefined ? {} : { startColumn: location.startColumn },
              ...location.endLine === undefined ? {} : { endLine: location.endLine },
              ...location.endColumn === undefined ? {} : { endColumn: location.endColumn },
            },
          },
      },
    }]
  })
}

/** Convert one finding to a SARIF result. */
function resultOf(finding: FindingSnapshot): unknown {
  const locations = physicalLocations(finding)
  return {
    ruleId: finding.ruleId,
    level: sarifLevel(finding.severity),
    message: { text: finding.summary },
    partialFingerprints: { 'dsh/findingFingerprint/v1': finding.fingerprint },
    ...locations.length === 0 ? {} : { locations },
    properties: {
      findingId: finding.id,
      revision: finding.revision,
      state: finding.state,
      severity: finding.severity,
      confidence: finding.confidence,
      targetIds: finding.identity.targetIds,
      dependencyLocations: finding.locations.filter(location => location.kind === 'dependency'),
      cweIds: finding.cweIds,
      cveIds: finding.cveIds,
      ...finding.cvss === undefined ? {} : { cvss: finding.cvss },
      assumptions: finding.assumptions,
      reachability: finding.reachability,
      evidence: finding.evidence.map(entry => ({
        role: entry.role,
        artifactId: entry.artifact.artifactId,
        sha256: entry.artifact.sha256,
        bytes: entry.artifact.bytes,
        mediaType: entry.artifact.mediaType,
        redaction: entry.artifact.redaction,
      })),
      ...finding.fixGuidance === undefined ? {} : { fixGuidance: finding.fixGuidance },
      occurrences: finding.occurrences,
      createdAt: finding.createdAt,
      updatedAt: finding.updatedAt,
      provenance: finding.provenance,
    },
  }
}

/**
 * Export complete findings as deterministic SARIF 2.1.0 bytes.
 * @param findings - Complete finding snapshots to export.
 * @param driverVersion - Producing tool package version.
 * @returns Deterministic UTF-8 SARIF 2.1.0 document bytes.
 */
export function exportFindingsSarif(findings: readonly FindingSnapshot[], driverVersion: string): Uint8Array {
  const ordered = stableFindings(findings)
  const firstByRule = new Map<string, FindingSnapshot>()
  for (const finding of ordered) {
    if (!firstByRule.has(finding.ruleId)) firstByRule.set(finding.ruleId, finding)
  }
  const ruleIds = [...firstByRule.keys()].sort()
  const rules = ruleIds.map((ruleId) => {
    const finding = firstByRule.get(ruleId)
    /* v8 ignore next 2 -- the rule id comes from the same unmodified map. */
    if (finding === undefined) throw new TypeError('SARIF rule disappeared during ordering')
    return {
      id: finding.ruleId,
      name: finding.title,
      shortDescription: { text: finding.title },
      fullDescription: { text: finding.summary },
      properties: { cweIds: finding.cweIds, cveIds: finding.cveIds },
    }
  })
  const results = ruleIds.flatMap(ruleId => ordered.filter(finding => finding.ruleId === ruleId).map(resultOf))
  return stableJsonDocument({
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'DeepSeek Harness Security Findings',
          version: driverVersion,
          rules,
        },
      },
      results,
    }],
  })
}
