---
description: "Model-facing read-only Azure tools for authorized cloud assessments."
kind: "package-reference"
---
# @cinlan/tool-azure

English | [中文](README.zh.md)

## Summary
This package registers the `az_account_show`, `azure_ad_enum`, and `azure_storage_enum` tools on `ctx.tools`. It shells out to a locally installed Azure CLI (`az`) through `ctx.subprocess`; every call first logs the service principal in with a fixed `--output json` argv and then runs its read-only listing, parsing the JSON into bounded rows. The client secret is resolved from the model-provided `credential_ref` at execution time through `ctx.get('credentials')` and never appears in model-visible arguments, tool results, or the Session log. Authorization is enforced upstream by `assessment-scope-tool-policy`: `az_account_show` under the `credential-use` action, `azure_ad_enum` and `azure_storage_enum` under the `reconnaissance` action through `cloudTools`.

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

#### Token effect

The tools add three descriptions and JSON schemas to the model tool context; results are byte-bounded by `maxOutputBytes` (default 256 KiB).

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
