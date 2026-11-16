---
description: "Model-facing read-only Tencent Cloud tools for authorized cloud assessments."
kind: "package-reference"
---
# @cinlan/tool-tencent

English | [中文](README.zh.md)

## Summary
This package registers the `tencent_identity_get`, `cam_enum`, `cos_enum`, `cam_policy_attach`, and `cam_policy_detach` tools on `ctx.tools`, shelling out to a locally installed Tencent Cloud tccli through `ctx.subprocess` with fixed JSON flags and explicit region arguments. Credentials resolve from `credential_ref` at execution time into the subprocess environment, never argv or the Session log. `assessment-scope-tool-policy` enforces the mapping upstream: identity confirmation under `credential-use`, enumeration under `reconnaissance`, and the policy pair under `persistence-change`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount with `@deepseek-ai/dsh-subprocess` (a provider such as `dsh-subprocess-local`), `@deepseek-ai/dsh-tools`, a credential provider such as `@deepseek-ai/dsh-credentials-local`, and `@deepseek-ai/dsh-assessment-scope-tool-policy` configured with `credentialTools` including `tencent_identity_get` and `cloudTools` including `cam_enum` and `cos_enum`. The `tccli` executable must be resolvable on the execution host's PATH or via `config.command`. The grant must declare a `cloud` target (provider `tencent`, the account id as the target value), list the mapped actions, and carry a `credentials` entry pairing the presented reference with that target. All three tools are read-only calls; read API requests still count against the account's request quota.

The credential secret format is `KEY=VALUE` lines restricted to `TENCENTCLOUD_SECRETID`, `TENCENTCLOUD_SECRETKEY`, and the optional `TENCENTCLOUD_SESSION_TOKEN`; both the secret id and secret key are required, and unsupported keys fail the call at execution time.

<a id="model-experience"></a>
## Model Experience

### tencent_identity_get tool schema

#### What the model sees

The model receives the generated [`tencent_identity_get` schema](../../../docs/tool-catalog.md#cinlantool-tencent): `target_id` (required account id matching a cloud grant target), `credential_ref` (required, an environment-variable-shaped name — the value never enters the conversation), and `region` (required, inside the target's region allowlist).

### cam_enum tool schema

#### What the model sees

The model receives the generated [`cam_enum` schema](../../../docs/tool-catalog.md#cinlantool-tencent): `target_id`, `resource` (required, one of `users`, `roles`), `limit` (optional page bound, default 100), optional `credential_ref` (injected as subprocess environment entries; without it the local tccli configuration chain supplies the credentials), and `region`, with `region` required.

### cos_enum tool schema

#### What the model sees

The model receives the generated [`cos_enum` schema](../../../docs/tool-catalog.md#cinlantool-tencent): `target_id`, `region`, optional `credential_ref` (injected as subprocess environment entries; without it the local tccli configuration chain supplies the credentials), and optional `public_status` (per-bucket `GetBucketAcl` anonymous-read check).

### cam_policy_attach tool schema

#### What the model sees

The model receives the generated [`cam_policy_attach` schema](../../../docs/tool-catalog.md#cinlantool-tencent): `target_id`, `policy_id` (a numeric id of an existing policy — no policy document is ever composed), `uin` (the numeric UIN of the user), optional `credential_ref`, and `region`, with the first three required. Grants that list `persistence-change` in `approvalRequiredActions` turn every call into an approval prompt.

### cam_policy_detach tool schema

#### What the model sees

The model receives the generated [`cam_policy_detach` schema](../../../docs/tool-catalog.md#cinlantool-tencent): the same parameter set as `cam_policy_attach`; it rolls the grant back. Detaching a policy that is not attached fails with a clear CLI error.

#### Token effect

The tools add five descriptions and JSON schemas to the model tool context; results are byte-bounded by `maxOutputBytes` (default 256 KiB).

#### KV Cache effect

The tool schemas are part of the model tool prefix and remain cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Requires a local Tencent Cloud tccli installation; the tool reports a clear error when the executable is missing.
- The credential secret rides in the subprocess environment, which the same local user can read through process-environment inspection during execution — but it never appears in model-visible arguments, results, or the Session log.
- The CAM roles listing uses the `ListRoles` API's `--page`/`--rp` paging parameters, which differ from the users listing's `--limit`/`--offset`; tccli versions that rename those parameters fail with a clear CLI error.
- The `cos_enum` public-status check reads the XML-API ACL wrapper through the API 3.0 envelope; buckets whose ACL cannot be parsed report as `unknown`, and buckets beyond `maxPublicChecks` (default 20) report as `skipped`.
- Write-path Tencent Cloud tools (resource mutation, privilege escalation paths) are deferred: this package is enumeration and identity confirmation only.

<a id="dev-note"></a>
### Dev Note

Keep the tool names, the `credential_ref` parameter name, the `credentialTools`/`cloudTools` wiring, and the `cloud` target shape synchronized with `assessment-scope-tool-policy` and the security-research bundle patch.
