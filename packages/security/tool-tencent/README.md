---
description: "Model-facing read-only Tencent Cloud tools for authorized cloud assessments."
kind: "package-reference"
---
# @cinlan/tool-tencent

English | [中文](README.zh.md)

## Summary
This package registers the `tencent_identity_get`, `cam_enum`, and `cos_enum` tools on `ctx.tools`. It shells out to a locally installed Tencent Cloud tccli through `ctx.subprocess` with fixed `--output json` flags and explicit `--region` arguments, parses the JSON into bounded rows, and never emits output-file arguments. The CAM secret key material is resolved from the model-provided `credential_ref` at execution time through `ctx.get('credentials')` and injected through the subprocess environment (`TENCENTCLOUD_SECRETID` / `TENCENTCLOUD_SECRETKEY` / `TENCENTCLOUD_SESSION_TOKEN`), never argv, model-visible arguments, tool results, or the Session log. Authorization is enforced upstream by `assessment-scope-tool-policy`: `tencent_identity_get` under the `credential-use` action, `cam_enum` and `cos_enum` under the `reconnaissance` action through `cloudTools`.

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

#### Token effect

The tools add three descriptions and JSON schemas to the model tool context; results are byte-bounded by `maxOutputBytes` (default 256 KiB).

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
