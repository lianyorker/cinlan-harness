/**
 * Registers the `security:workflow` system prompt section that teaches the
 * model how to coordinate scan, record, triage, fix, and report phases. The
 * section references the existing `workflow`, `finding_*`, and vulnerability KB
 * tools without introducing a new capability or enforcing phase completion.
 *
 * @module @deepseek-ai/dsh-security-workflow-prompt
 */

import type { Context } from '@deepseek-ai/cordis'
// Declaration merge only: makes ctx.systemPrompt visible for the section registration.
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'security-workflow-prompt'
export const inject = ['systemPrompt']

/** Stable model guidance for the security workflow loop. */
const SECURITY_WORKFLOW_PROMPT = `When the user asks for a security scan or vulnerability assessment, use the workflow tool to orchestrate a security workflow loop with these phases:

1. **Recon & Attack-Surface Mapping**: Classify the target's attack surface and dispatch specialized agent() calls per surface type:
   - **Web/API**: Run semgrep, nuclei, nikto, ffuf. Focus on OWASP Top 10, injection, auth bypass, IDOR, SSRF.
   - **Cloud/Infra**: Run trivy, scout, prowler. Focus on IAM misconfiguration, exposed storage, workload reachability.
   - **Source Code**: Run semgrep, codeql, npm audit, pip-audit. Focus on taint flow, unsafe deserialization, hardcoded secrets.
   - **Mobile**: Run apktool, jadx, mobSF. Focus on OWASP MASTG, insecure storage, certificate pinning.
   - **Binary/Firmware**: Run binwalk, strings, checksec. Focus on memory safety, hardcoded credentials, debug interfaces.
   Use parallel() to run independent surface scans concurrently. Capture raw scanner output as structured JSON when possible.

2. **Record**: For each scanner finding, call finding_record with the rule id, target, location, severity, confidence, and reachability. Use the observation state for unconfirmed findings and hypothesis for suspected issues. The service deduplicates by canonical identity (rule + targets + locations), so repeated scans increment occurrences without duplicating entries.

3. **Triage & PoC Validation**: Review recorded findings with finding_query (filter by state=observation or state=hypothesis). For each finding, use agent() calls to:
   - Assess reachability: trace the data path from source to sink.
   - **Enrich with vulnerability KB**: If the finding maps to a known CVE, call vuln_read with the CVE id to get full details (CVSS vector, affected ranges, references). If the finding is from a dependency scan, call vuln_query with the ecosystem and package name to check for known vulnerabilities and fix versions.
   - Build a minimal proof-of-concept: construct the exact request, payload, or input that triggers the vulnerability.
   - Execute the PoC and capture evidence: HTTP request/response, error output, crash log, or side-effect observation.
   - For blind vulnerabilities (SSRF, XXE, blind injection): use out-of-band confirmation (DNS callback, HTTP callback, time-based oracle) rather than guessing from response diffs.
   - A finding is only promoted to reproduced-vulnerability when you have concrete reproduction evidence (the exact request/input that triggers it and the observed impact). Anything you cannot reproduce stays as observation or is demoted to unresolved.
   Call finding_transition to promote confirmed findings to reproduced-vulnerability (requires reproduction evidence) or demote to unresolved.

4. **Fix & Retest**: For reproduced-vulnerability findings:
   - Use agent() calls to implement the fix: patch the vulnerable code, add input validation, update dependencies, or adjust configuration.
   - **Retest**: After applying the fix, re-run the exact PoC that originally triggered the vulnerability. Verify the exploit no longer works and the original functionality is preserved.
   - Call finding_transition to move the finding to remediation only after the retest confirms the fix is effective. Provide remediation-validation evidence (the retest result showing the PoC no longer triggers) and fixGuidance (a description of what was changed and why).
   - If the retest shows the fix is incomplete, iterate: adjust the fix and retest again. Do not mark as remediation until the PoC is definitively blocked.

5. **Report**: Call finding_export with format=sarif for machine-readable output, or format=markdown for human review. The export publishes an ArtifactRef — do not embed full report bytes in the transcript. Include in the report:
   - Finding summary with severity, confidence, and state counts.
   - Reproduction evidence for each reproduced-vulnerability.
   - Fix description and retest results for each remediation.
   - Residual risk: findings left as observation or unresolved.

Use finding_query with state and severity filters to track progress across phases. The workflow script should return a summary object with counts by state. Prefer parallel() for independent scanner runs and pipeline() for the scan→record→triage chain per finding.`

/**
 * Register the security workflow prompt section.
 * @param ctx - Cordis context carrying the system prompt service.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'security:workflow',
    order: 116,
    text: SECURITY_WORKFLOW_PROMPT,
  })
}
