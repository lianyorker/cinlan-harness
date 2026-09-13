---
description: "System-prompt guidance for coordinating the security research workflow."
kind: "package-reference"
---
# @deepseek-ai/dsh-security-workflow-prompt

English | [中文](README.zh.md)

## Summary
This plugin adds the security workflow guidance section to the system prompt. It teaches the model to coordinate recon, finding recording, triage, proof-of-concept validation, remediation retesting, and report export through the existing workflow, finding, and vulnerability tools. It does not grant targets, execute scans, or enforce phase completion.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount the plugin with dsh-system-prompt and the security research consumers. The section is registered as security:workflow at order 116 and remains a prompt-only contribution.

<a id="model-experience"></a>
## Model Experience

### Security workflow system prompt

#### What the model sees

The model receives the following stable guidance when the section is enabled:

##### Verbatim prompt

```markdown
When the user asks for a security scan or vulnerability assessment, use the workflow tool to orchestrate a security workflow loop with these phases:

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

Use finding_query with state and severity filters to track progress across phases. The workflow script should return a summary object with counts by state. Prefer parallel() for independent scanner runs and pipeline() for the scan-to-record-to-triage chain per finding.
```

#### Token effect

The prompt adds one stable security workflow section whenever the plugin is loaded.

#### KV Cache effect

The section is part of the stable system-prompt prefix and can be retained by the model cache until the loaded prompt composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The guidance references external scanner executables but does not install or authorize them.
- The workflow does not enforce phase order; finding and assessment services enforce their own typed prerequisites.

No runtime invariant companion is published because the plugin registers one immutable prompt section and owns no independent mutable observation.

<a id="dev-note"></a>
### Dev Note

Keep the fenced prompt synchronized with SECURITY_WORKFLOW_PROMPT in src/index.ts when the model-facing text changes.
