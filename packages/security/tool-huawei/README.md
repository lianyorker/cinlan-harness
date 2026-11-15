---
description: "Model-facing read-only Huawei Cloud tools for authorized cloud assessments."
kind: "package-reference"
---
# @cinlan/tool-huawei

English | [中文](README.zh.md)

## Summary
This package registers the `huawei_identity_get`, `huawei_iam_enum`, and `obs_enum` tools on `ctx.tools`. It shells out to the Huawei Cloud KooCLI (`hcloud`) through `ctx.subprocess` — the binary name is shared with the unrelated Hetzner Cloud CLI, so every error message names the Huawei Cloud KooCLI explicitly — and `obs_enum` uses the separate `obsutil` binary. KooCLI calls carry fixed region and project arguments and print JSON; the obsutil listing prints text lines parsed into bounded rows. No output-file arguments are ever emitted. The access key pair is resolved from the model-provided `credential_ref` at execution time through `ctx.get('credentials')` and never appears in model-visible arguments, tool results, or the Session log. Authorization is enforced upstream by `assessment-scope-tool-policy`: `huawei_identity_get` under the `credential-use` action, `huawei_iam_enum` and `obs_enum` under the `reconnaissance` action through `cloudTools`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount with `@deepseek-ai/dsh-subprocess` (a provider such as `dsh-subprocess-local`), `@deepseek-ai/dsh-tools`, a credential provider such as `@deepseek-ai/dsh-credentials-local`, and `@deepseek-ai/dsh-assessment-scope-tool-policy` configured with `credentialTools` including `huawei_identity_get` and `cloudTools` including `huawei_iam_enum` and `obs_enum`. The `hcloud` (Huawei Cloud KooCLI) and `obsutil` executables must be resolvable on the execution host's PATH or via `config.command` / `config.obsCommand`. The grant must declare a `cloud` target (provider `huawei`, the account id as the target value), list the mapped actions, and carry a `credentials` entry pairing the presented reference with that target. All three tools are read-only calls; read API requests still count against the account's request quota.

The credential secret format is `KEY=VALUE` lines restricted to `HW_ACCESS_KEY_ID`, `HW_SECRET_ACCESS_KEY`, and the optional `HW_SECURITY_TOKEN`; both the key id and secret key are required, and unsupported keys fail the call at execution time.

<a id="model-experience"></a>
## Model Experience

### huawei_identity_get tool schema

#### What the model sees

The model receives the generated [`huawei_identity_get` schema](../../../docs/tool-catalog.md#cinlantool-huawei): `target_id` (required account id matching a cloud grant target), `credential_ref` (required, an environment-variable-shaped name — the value never enters the conversation), and `region` (required, inside the target's region allowlist).

### huawei_iam_enum tool schema

#### What the model sees

The model receives the generated [`huawei_iam_enum` schema](../../../docs/tool-catalog.md#cinlantool-huawei): `target_id`, `resource` (required, `users` or `keys` — the account's permanent access keys), `project_id` (required — the IAM v3 listings are project-scoped), `credential_ref`, and `region`, all required.

### obs_enum tool schema

#### What the model sees

The model receives the generated [`obs_enum` schema](../../../docs/tool-catalog.md#cinlantool-huawei): `target_id`, `credential_ref`, and `region`, all required. Results are bucket rows parsed from the obsutil text listing.

#### Token effect

The tools add three descriptions and JSON schemas to the model tool context; results are byte-bounded by `maxOutputBytes` (default 256 KiB).

#### KV Cache effect

The tool schemas are part of the model tool prefix and remain cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Requires local Huawei Cloud KooCLI and obsutil installations; the tool reports a clear error naming the missing executable.
- Neither KooCLI nor obsutil has an environment-based credential channel, so the access key pair rides on the argv (`--cli-secret-key` / `-k=`) and is visible in the local process list during execution — it never appears in model-visible arguments, results, or the Session log.
- The KooCLI binary name `hcloud` collides with the unrelated Hetzner Cloud CLI; `config.command` points at the Huawei Cloud KooCLI and errors name it explicitly.
- The IAM user and key listings reflect the KooCLI's snake_case serialization of the IAM (v3) payload; IAM role and policy listings are deferred.
- The `obs_enum` public-access check is deferred: obsutil exposes bucket ACL details only through its API subcommands, which would need a dedicated integration.
- Write-path Huawei Cloud tools (IAM mutation, resource creation) are deferred: this package is enumeration and identity confirmation only.

<a id="dev-note"></a>
### Dev Note

Keep the tool names, the `credential_ref` parameter name, the `credentialTools`/`cloudTools` wiring, and the `cloud` target shape synchronized with `assessment-scope-tool-policy` and the security-research bundle patch.
