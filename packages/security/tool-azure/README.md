---
description: "Model-facing read-only Azure tools for authorized cloud assessments."
kind: "package-reference"
---
# @cinlan/tool-azure

English | [中文](README.zh.md)

## Summary
This package registers the `az_account_show`, `azure_ad_enum`, `azure_storage_enum`, `role_assignment_create`, and `role_assignment_delete` tools on `ctx.tools`, shelling out to a locally installed Azure CLI through `ctx.subprocess`; every call first logs the service principal in, then runs its listing or role-assignment change with fixed JSON flags. The client secret resolves from `credential_ref` at execution time and never appears in model-visible arguments, tool results, or the Session log. `assessment-scope-tool-policy` enforces the mapping upstream: subscription confirmation under `credential-use`, enumeration under `reconnaissance`, and the role pair under `persistence-change`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount with `@deepseek-ai/dsh-subprocess` (a provider such as `dsh-subprocess-local`), `@deepseek-ai/dsh-tools`, a credential provider such as `@deepseek-ai/dsh-credentials-local`, and `@deepseek-ai/dsh-assessment-scope-tool-policy` configured with `credentialTools` including `az_account_show` and `cloudTools` including `azure_ad_enum` and `azure_storage_enum`. The `az` executable must be resolvable on the execution host's PATH or via `config.command`. The grant must declare a `cloud` target (provider `azure`, the account id as the target value), list the mapped actions, and carry a `credentials` entry pairing the presented reference with that target. All three tools are read-only calls; read API requests still count against the tenant's quota.

The credential secret format is `KEY=VALUE` lines restricted to `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET`, and the optional `AZURE_SUBSCRIPTION_ID`; the first three are required, ids must be GUIDs, and unsupported keys fail the call at execution time.

<a id="model-experience"></a>
## Model Experience

### az_account_show tool schema

#### What the model sees

The model receives the generated [`az_account_show` schema](../../../docs/tool-catalog.md#cinlantool-azure): `target_id` (required account id matching a cloud grant target) and `credential_ref` (required, an environment-variable-shaped name — the value never enters the conversation). Results are subscription rows with tenant ids.

### azure_ad_enum tool schema

#### What the model sees

The model receives the generated [`azure_ad_enum` schema](../../../docs/tool-catalog.md#cinlantool-azure): `target_id`, `resource` (required, one of `users`, `role-assignments`), `credential_ref`, and optional `subscription` (a GUID inside the target's subscription allowlist).

### azure_storage_enum tool schema

#### What the model sees

The model receives the generated [`azure_storage_enum` schema](../../../docs/tool-catalog.md#cinlantool-azure): `target_id`, `credential_ref`, and optional `subscription`. Results are account rows carrying `allowBlobPublicAccess` and HTTPS-only settings.

### role_assignment_create tool schema

#### What the model sees

The model receives the generated [`role_assignment_create` schema](../../../docs/tool-catalog.md#cinlantool-azure): `target_id`, `assignee` (object id or UPN), `role` (an existing role name — no role definition is ever composed), `scope` (`/subscriptions/...` paths), `credential_ref`, and optional `subscription`, with the first five required. Grants that list `persistence-change` in `approvalRequiredActions` turn every call into an approval prompt.

### role_assignment_delete tool schema

#### What the model sees

The model receives the generated [`role_assignment_delete` schema](../../../docs/tool-catalog.md#cinlantool-azure): the same parameter set as `role_assignment_create`; it rolls the assignment back. Deleting an assignment that does not exist completes with no change.

#### Token effect

The tools add five descriptions and JSON schemas to the model tool context; results are byte-bounded by `maxOutputBytes` (default 256 KiB).

#### KV Cache effect

The tool schemas are part of the model tool prefix and remain cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Requires a local Azure CLI installation; the tool reports a clear error when the executable is missing.
- The az CLI has no environment-based service-principal login, so the client secret rides on the `az login` argv and is visible in the local process list during execution — it never appears in model-visible arguments, results, or the Session log.
- Every tool call performs its own `az login`, which updates the operator's local `~/.azure` login state; the caller's ambient az configuration (subscription defaults) is otherwise not used for arguments.
- The `az ad user list` call has no server-side page bound; accounts with very large directories are cut off by `maxOutputBytes` rather than silently truncated.
- Write-path Azure tools (role-assignment mutation, resource creation) are deferred: this package is enumeration and identity confirmation only.

<a id="dev-note"></a>
### Dev Note

Keep the tool names, the `credential_ref` parameter name, the `credentialTools`/`cloudTools` wiring, and the `cloud` target shape synchronized with `assessment-scope-tool-policy` and the security-research bundle patch.
