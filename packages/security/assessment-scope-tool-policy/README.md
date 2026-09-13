---
description: "Fail-closed assessment authorization for shell, network, and Browser model tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-assessment-scope-tool-policy

English | [中文](README.zh.md)

## Summary

This optional Consumer checks assessment scope before model-facing shell, network, and Browser tools execute. It records one operation decision per matched call and installs a monotonic guard against listener bypass.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount it after assessment-scope-session and execution-host. Default sets cover `bash`, `pwsh`, `web_search`, `web_fetch`, and native Browser tools. Calls without a resolvable target are denied; URL calls also require target-scoped egress. `finding_export` is checked by its own Consumer against the same report-download action.

<a id="model-experience"></a>
## Model Experience

### Authorization decisions

#### What the model sees

Denied or approval-required calls receive ordinary tool errors or approval prompts, and each matched `tools/pre-execute` decision is recorded in the Session log.

#### Token effect

The Consumer adds no prompt text or schemas.

#### KV Cache effect

Authorization does not alter the model cache prefix.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Shell commands cannot infer a target from arbitrary command text; use an explicit target_id or a sole grant target.
- Browser page actions need an HTTP page URL to resolve a target.
- finding_export uses its own complete-report authorization and is not double-logged here.

No runtime invariant companion is published because the Consumer owns no independent projection.

<a id="dev-note"></a>
### Dev Note

Keep this optional layer out of generic Web profiles without assessment scope services.
