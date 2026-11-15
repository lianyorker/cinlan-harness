---
description: "Fail-closed assessment authorization for shell, network, and Browser model tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-assessment-scope-tool-policy

English | [中文](README.zh.md)

## Summary

This optional Consumer checks assessment scope before model-facing shell, network, Browser, and credential tools execute, with explicitly configured workspace command exceptions. It installs a monotonic guard against listener bypass.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount it after assessment-scope-session and execution-host. Default sets cover `bash`, `pwsh`, `web_search`, `web_fetch`, and native Browser tools. Calls without a resolvable target are denied; URL calls also require target-scoped egress. `finding_export` is checked by its own Consumer against the same report-download action.

`credentialTools` defaults to no entries. Each listed tool call maps to the `credential-use` action and must carry a well-formed `credential_ref` argument (the environment-variable-shaped name of a granted secret, never the value); the Consumer resolves the reference into the operation credential so the scope service matches it against the grant's `credentials` entries with the `target-authentication` purpose. Grants that list `credential-use` in `approvalRequiredActions` turn every such call into an approval prompt. An absent or empty list enforces no credential tools; a provided list must be trimmed and duplicate-free.

`exploitTools` and `persistenceTools` follow the same shape and map their calls to the `exploit-execution` and `persistence-change` actions respectively, with no credential argument required. Grants that list those actions in `approvalRequiredActions` turn every such call into an approval prompt.

`workspaceCommands` defaults to an empty list. Each entry names a configured shell `tool` and an exact `command`; empty, whitespace-padded, duplicate, or non-shell entries fail at load. A matching call needs an absolute Session workspace and an existing working directory whose resolved path stays inside it. Explicit target or URL arguments, sandbox permission overrides, and background execution exclude the exception. Unmatched calls retain assessment checks; admitted workspace commands still pass downstream guards and sandbox policy.

These entries trust the workspace and its command environment, including scripts invoked by a package manager. They do not classify arbitrary shell text as safe or confine subprocess effects to the working directory. The deployment sandbox owns that confinement.

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
