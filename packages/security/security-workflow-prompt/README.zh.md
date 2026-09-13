---
description: "安全研发工作流协调系统提示指导。"
kind: "package-reference"
---
# @deepseek-ai/dsh-security-workflow-prompt

[English](README.md) | 中文

## 概述
本插件向系统提示添加安全工作流指导段落。它指导模型通过既有 workflow、Finding 和漏洞工具协调侦察、Finding 记录、分类、概念验证、修复重测和报告导出。它不授予目标、不执行扫描，也不强制阶段完成。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
将插件与 dsh-system-prompt 和安全研发消费者一起挂载。该段落以 security:workflow 名称和 116 顺序注册，是纯 prompt 贡献。

<a id="model-experience"></a>
## 模型体验

### Security workflow system prompt

#### What the model sees

启用该段落时，模型会收到以下稳定指导：

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

插件加载后向请求添加一个稳定的安全工作流段落。

#### KV Cache effect

该段落属于稳定的 system-prompt 前缀；在加载的 prompt 组合发生变化前可以由模型缓存保留。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 指导引用外部扫描器可执行文件，但不会安装或授权它们。
- 工作流不会强制阶段顺序；Finding 和评估服务执行各自的类型化前置条件。

不发布 runtime invariant companion，因为插件注册一段不可变 prompt，不拥有独立的可变观察。

<a id="dev-note"></a>
### 开发备注

模型可见文本变化时，保持此处的 fenced prompt 与 src/index.ts 中的 SECURITY_WORKFLOW_PROMPT 同步。
