---
description: "Redacted Security Research configuration and skill-discovery status for Settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-security-research-controller

English | [中文](README.zh.md)

## Summary

Read Security Research preset availability, scope configuration, active plugin contributions, and bundled skill discovery through the securityResearch/describe Remote.

## Table of Contents

- [Use this package](#use-this-package)
- [Report downloads](#report-downloads)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The Web bundle mounts this controller with the Typert registry. Security services are optional. The controller reads existing services without mounting a preset, changing authorization, querying vulnerability APIs, or starting external tools.

The response distinguishes configured, not-configured, and attention. Missing targets, actions, or execution hosts remain unconfigured. Future and expired grants retain distinct scope states. A broken preset, inactive contribution, empty skill catalog, or incomplete discovery cannot produce configured. Counts exclude unrelated skill providers and reflect the current global security-skills catalog.

The response omits target values, host identifiers, credential references, authorization references, paths, skill bodies, and raw preset errors. Cancellation prevents a late successful response.

<a id="report-downloads"></a>
## Report downloads

The authenticated securityResearch/exportReport operation accepts a live Session id and json, markdown, or sarif format. It reads complete same-Session Findings, checks every contained target against the immutable Session grant, and requires the report-download action on the active Execution Host. Approval-required, excluded, unknown, expired, or revoked authority returns no bytes. Empty reports require an admitted grant target.

Report-download authorizes the existing authenticated Harness client channel, including authenticated remote clients; it is not arbitrary outbound data-export or external-reporting. Those actions retain their exact egress requirements. Reports preserve free-text Finding metadata and Artifact references without embedding Artifact contents. They perform no redaction and require a grant that accepts none. Downloaded files have no automatic retention enforcement.

maxFindings defaults to 2000; maxReportBytes defaults to 4194304. Limit violations, concurrent Session changes, non-advancing pagination, cancellation, or missing durable storage refuse the complete report rather than returning a partial file. Authorization decisions use existing assessment/operation-decided events and reach a Session storage checkpoint before bytes are returned; authority is rechecked after that wait.

<a id="model-experience"></a>
## Model Experience

### Configuration status

#### What the model sees

None; `securityResearch/describe` serves browser configuration and registers no model tool or prompt. Download audit events are log-only.

#### Token effect

None; status responses are not added to model requests.

#### KV Cache effect

None; status reads do not alter model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Configuration completeness is not operational readiness or authorization for an effect. The controller does not verify external tools, network connectivity, finding persistence, or complete enforcement across tool execution paths. Scope editing uses the Settings namespace; plugin installation, Finding browsing, and complete shell/browser/network enforcement remain separate.

No runtime invariant companion is published: the controller returns immediate observations and retains no independent security state.


<a id="dev-note"></a>
### Dev Note

Status describes configuration only. Execution policies remain with effect-owning Consumers.
