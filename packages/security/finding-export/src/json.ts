/** Deterministic JSON finding exporter. */

import type { FindingSnapshot } from '@deepseek-ai/dsh-finding'
import { exportTimestamp, stableFindings, stableJsonDocument } from './stable.ts'

/**
 * Export the complete typed finding set as `dsh.findings.export/v1`.
 * @param findings - Complete finding snapshots to export.
 * @returns Deterministic UTF-8 JSON document bytes.
 */
export function exportFindingsJson(findings: readonly FindingSnapshot[]): Uint8Array {
  const ordered = stableFindings(findings)
  return stableJsonDocument({
    schema: 'dsh.findings.export/v1',
    generatedAt: exportTimestamp(ordered),
    findings: ordered,
  })
}
