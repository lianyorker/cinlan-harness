/** Deterministic human-readable Markdown finding exporter. */

import type { FindingLocation, FindingReachability, FindingSnapshot } from '@deepseek-ai/dsh-finding'
import { exportTimestamp, stableFindings, utf8Document } from './stable.ts'

/** Protect inline Markdown delimiters without changing the retained value. */
function inline(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('|', '\\|')
}

/** Render one typed location. */
function locationLine(location: FindingLocation): string {
  if (location.kind === 'dependency') {
    const version = location.version === undefined ? '' : `@${inline(location.version)}`
    const manifest = location.manifestUri === undefined ? '' : ` in ${inline(location.manifestUri)}`
    return `dependency ${inline(location.ecosystem)}:${inline(location.packageName)}${version}${manifest}`
  }
  const region = location.startLine === undefined
    ? ''
    : `:${location.startLine}${location.startColumn === undefined ? '' : `:${location.startColumn}`}`
  return `code ${inline(location.uri)}${region}`
}

/** Render one reachability value. */
function reachabilityLine(reachability: FindingReachability): string {
  switch (reachability.kind) {
    case 'unknown':
      return 'unknown'
    case 'unreachable':
      return `unreachable: ${inline(reachability.reason)}`
    case 'reachable': {
      const evidence = reachability.pathEvidence === undefined
        ? ''
        : ` (path evidence ${reachability.pathEvidence.artifactId})`
      return `reachable from ${inline(reachability.entrypoint)}${evidence}`
    }
  }
}

/** Append one complete finding section. */
function appendFinding(lines: string[], finding: FindingSnapshot): void {
  lines.push(
    `## ${inline(finding.title)}`,
    '',
    `- Finding ID: \`${finding.id}\``,
    `- Rule ID: \`${finding.ruleId}\``,
    `- Fingerprint: \`${finding.fingerprint}\``,
    `- State: \`${finding.state}\``,
    `- Severity: \`${finding.severity}\``,
    `- Confidence: \`${finding.confidence}\``,
    `- Occurrences: ${finding.occurrences}`,
    `- Created at: ${finding.createdAt}`,
    `- Updated at: ${finding.updatedAt}`,
    '',
    finding.summary,
    '',
    '### Targets',
    '',
  )
  for (const target of finding.targets) {
    lines.push(`- \`${target.id}\` (${target.kind}): ${inline(target.displayName)}`)
  }
  lines.push('', '### Locations', '')
  if (finding.locations.length === 0) lines.push('- None')
  for (const location of finding.locations) lines.push(`- ${locationLine(location)} (target \`${location.targetId}\`)`)
  lines.push(
    '',
    `- CWE: ${finding.cweIds.length === 0 ? 'None' : finding.cweIds.map(id => `\`${id}\``).join(', ')}`,
    `- CVE: ${finding.cveIds.length === 0 ? 'None' : finding.cveIds.map(id => `\`${id}\``).join(', ')}`,
    `- CVSS: ${finding.cvss === undefined ? 'None' : `${finding.cvss.version} ${inline(finding.cvss.vector)} (${finding.cvss.score})`}`,
    `- Reachability: ${reachabilityLine(finding.reachability)}`,
    `- Assumptions: ${finding.assumptions.length === 0 ? 'None' : finding.assumptions.map(inline).join('; ')}`,
    `- Fix guidance: ${finding.fixGuidance === undefined ? 'None' : inline(finding.fixGuidance)}`,
    '',
    '### Evidence',
    '',
  )
  if (finding.evidence.length === 0) lines.push('- None')
  for (const evidence of finding.evidence) {
    const artifact = evidence.artifact
    const note = evidence.note === undefined ? '' : `, ${inline(evidence.note)}`
    lines.push(`- ${evidence.role}: \`${artifact.artifactId}\`, sha256 \`${artifact.sha256}\`, ${artifact.bytes} bytes, ${inline(artifact.mediaType)}, redaction \`${artifact.redaction}\`${note}`)
  }
  lines.push('', '### Provenance', '')
  for (const source of finding.provenance) {
    lines.push(`- \`${source.pluginId}\` ${inline(source.pluginVersion)} via \`${source.toolName}\``)
  }
  lines.push('')
}

/**
 * Export complete findings as stable Markdown with Artifact metadata only.
 * @param findings - Complete finding snapshots to export.
 * @returns Deterministic UTF-8 Markdown document bytes.
 */
export function exportFindingsMarkdown(findings: readonly FindingSnapshot[]): Uint8Array {
  const ordered = stableFindings(findings)
  const lines = [
    '# Security Findings',
    '',
    `Generated at: ${new Date(exportTimestamp(ordered)).toISOString()}`,
    '',
    `Finding count: ${ordered.length}`,
    '',
  ]
  for (const finding of ordered) appendFinding(lines, finding)
  return utf8Document(lines.join('\n'))
}
