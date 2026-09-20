---
description: "Manage security skill resources and read Session assessment status through authenticated Remotes."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-security-research-controller

English | [中文](README.zh.md)

## Summary

Install, update, cancel, and remove security skill resources from Settings. Session consumers can also read Security Research configuration and export authorized Findings reports.

## Table of Contents

- [Use this package](#use-this-package)
- [Resource management](#resource-management)
- [Report downloads](#report-downloads)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

The Web bundle mounts this controller with the Typert registry. Security services are optional. `securityResearch/describe` reads existing services without mounting a preset, changing assessment authorization, querying vulnerability APIs, or starting external tools.

The response distinguishes configured, not-configured, and attention. Missing targets, actions, or execution hosts remain unconfigured. Future and expired grants retain distinct scope states. A broken preset, inactive contribution, empty skill catalog, or incomplete discovery cannot produce configured. Counts exclude unrelated skill providers and reflect the current global security-skills catalog.

The response omits target values, host identifiers, credential references, authorization references, paths, skill bodies, and raw preset errors. Cancellation prevents a late successful response.

<a id="resource-management"></a>
## Resource management

The authenticated `securityResearch` Remotes delegate resource operations to [`security-skills/resources`](../../security/security-skills/README.md). `describeResources` reads current state; `observeResources` streams complete replacement snapshots and coalesces progress while a consumer is paused. Missing managers produce `state: unavailable` with `reason: component-missing`; mutations return an explicit resources-unavailable error.

Installation, reinstallation, update, release checks, bundled installation, and removal return the manager’s admitted operation state. The Host owns that operation after admission: closing Settings, disconnecting a client, or unloading this controller ends observations without cancelling the work. `cancelResource` requires the observed operation id, so a late cancellation cannot stop its replacement. Manager disposal owns task shutdown.

The manager owns installed generations, release configuration, progress, failures, and skill registry visibility. The controller stores none of these independently. Installing packaged resources requires the explicit bundled action; a missing download source remains unavailable. Resource management executes no installed scripts and does not require an assessment grant.

<a id="report-downloads"></a>
## Report downloads

The authenticated securityResearch/exportReport operation accepts a live Session id and json, markdown, or sarif format. It reads complete same-Session Findings, checks every contained target against the immutable Session grant, and requires the report-download action on the active Execution Host. Approval-required, excluded, unknown, expired, or revoked authority returns no bytes. Empty reports require an admitted grant target.

Report-download authorizes the existing authenticated Harness client channel, including authenticated remote clients; it is not arbitrary outbound data-export or external-reporting. Those actions retain their exact egress requirements. Reports preserve free-text Finding metadata and Artifact references without embedding Artifact contents. They perform no redaction and require a grant that accepts none. Downloaded files have no automatic retention enforcement.

maxFindings defaults to 2000; maxReportBytes defaults to 4194304. Limit violations, concurrent Session changes, non-advancing pagination, cancellation, or missing durable storage refuse the complete report rather than returning a partial file. Authorization decisions use existing assessment/operation-decided events and reach a Session storage checkpoint before bytes are returned; authority is rechecked after that wait.

<a id="model-experience"></a>
## Model Experience

### Configuration status

#### What the model sees

The controller registers no model tool or prompt. `describeResources` and `observeResources` responses stay in Settings; the [skill provider](../../security/security-skills/README.md) owns catalog changes after installation. Report download audit events are log-only.

#### Token effect

None; status responses are not added to model requests.

#### KV Cache effect

None; status reads do not alter model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Configuration completeness is not operational readiness or authorization for an effect. The controller does not verify external tools, network connectivity, finding persistence, or complete enforcement across tool execution paths. Scope editing uses the Settings namespace; plugin installation, Finding browsing, and complete shell/browser/network enforcement remain separate.

No runtime invariant companion is published: the controller projects service-owned state and retains only observer lifetimes.


<a id="dev-note"></a>
### Dev Note

Status describes configuration only. Execution policies remain with effect-owning Consumers.
