---
description: "Model-facing read-only Alibaba Cloud tools for authorized cloud assessments."
kind: "package-reference"
---
# @cinlan/tool-aliyun

English | [中文](README.zh.md)

## Summary
This package registers the `aliyun_identity_get`, `ram_enum`, and `oss_enum` tools on `ctx.tools`. It shells out to a locally installed Alibaba Cloud CLI (`aliyun`) through `ctx.subprocess` with explicit `--region` arguments, parses stdout into bounded rows, and never emits output-file arguments. The AccessKey material is resolved from the model-provided `credential_ref` at execution time through `ctx.get('credentials')` and injected through the subprocess environment (`ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET` / `ALIBABA_CLOUD_SECURITY_TOKEN`), never argv, model-visible arguments, tool results, or the Session log. Authorization is enforced upstream by `assessment-scope-tool-policy`: `aliyun_identity_get` under the `credential-use` action, `ram_enum` and `oss_enum` under the `reconnaissance` action through `cloudTools`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount with `@deepseek-ai/dsh-subprocess` (a provider such as `dsh-subprocess-local`), `@deepseek-ai/dsh-tools`, a credential provider such as `@deepseek-ai/dsh-credentials-local`, and `@deepseek-ai/dsh-assessment-scope-tool-policy` configured with `credentialTools` including `aliyun_identity_get` and `cloudTools` including `ram_enum` and `oss_enum`. The `aliyun` executable must be resolvable on the execution host's PATH or via `config.command`. The grant must declare a `cloud` target (provider `aliyun`, the account id as the target value), list the mapped actions, and carry a `credentials` entry pairing the presented reference with that target. All three tools are read-only calls; read API requests still count against the account's request quota.

The credential secret format is `KEY=VALUE` lines restricted to `ALIBABA_CLOUD_ACCESS_KEY_ID`, `ALIBABA_CLOUD_ACCESS_KEY_SECRET`, and the optional `ALIBABA_CLOUD_SECURITY_TOKEN`; both the key id and secret are required, and unsupported keys fail the call at execution time.

<a id="model-experience"></a>
## Model Experience

### aliyun_identity_get tool schema

#### What the model sees

The model receives the generated [`aliyun_identity_get` schema](../../../docs/tool-catalog.md#cinlantool-aliyun): `target_id` (required account id matching a cloud grant target), `credential_ref` (required, an environment-variable-shaped name — the value never enters the conversation), and `region` (required, inside the target's region allowlist).

### ram_enum tool schema

#### What the model sees

The model receives the generated [`ram_enum` schema](../../../docs/tool-catalog.md#cinlantool-aliyun): `target_id`, `limit` (optional `--PageSize`, default 100), optional `credential_ref`, and `region`, with `region` required. RAM is a global product; use the account's center region.

### oss_enum tool schema

#### What the model sees

The model receives the generated [`oss_enum` schema](../../../docs/tool-catalog.md#cinlantool-aliyun): `target_id`, optional `credential_ref`, `region`, and optional `public_status` (per-bucket `ossutil api get-bucket-acl` anonymous-read check, which requires an aliyun CLI with embedded ossutil 2.0). Results are bucket rows parsed from the built-in ossutil text listing.

#### Token effect

The tools add three descriptions and JSON schemas to the model tool context; results are byte-bounded by `maxOutputBytes` (default 256 KiB).

#### KV Cache effect

The tool schemas are part of the model tool prefix and remain cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Requires a local Alibaba Cloud CLI installation; the tool reports a clear error when the executable is missing.
- The credential secret rides in the subprocess environment, which the same local user can read through process-environment inspection during execution — but it never appears in model-visible arguments, results, or the Session log.
- The `oss_enum` listing parses the built-in ossutil's text output (one `oss://bucket` line per bucket); the `public_status` check uses `aliyun ossutil api get-bucket-acl` and requires an aliyun CLI whose embedded ossutil is 2.0 or newer, and buckets beyond `maxPublicChecks` (default 20) report as `skipped` while buckets whose ACL cannot be read report as `unknown`.
- RAM role and policy listings are deferred: this package enumerates users only.
- Write-path Alibaba Cloud tools (resource mutation, privilege escalation paths) are deferred: this package is enumeration and identity confirmation only.

<a id="dev-note"></a>
### Dev Note

Keep the tool names, the `credential_ref` parameter name, the `credentialTools`/`cloudTools` wiring, and the `cloud` target shape synchronized with `assessment-scope-tool-policy` and the security-research bundle patch.
