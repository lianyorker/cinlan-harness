---
description: "Model-facing read-only AWS tools for authorized cloud assessments."
kind: "package-reference"
---
# @cinlan/tool-aws

English | [中文](README.zh.md)

## Summary
This package registers the `sts_get_caller_identity`, `iam_enum`, `s3_enum`, `iam_policy_attach`, and `iam_policy_detach` tools on `ctx.tools`, shelling out to a locally installed AWS CLI v2 through `ctx.subprocess` with fixed JSON flags and no output-file arguments. Credentials resolve from `credential_ref` at execution time into the subprocess environment, never argv or the Session log. `assessment-scope-tool-policy` enforces the mapping upstream: identity confirmation under `credential-use`, enumeration under `reconnaissance`, and the policy pair under `persistence-change`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount with `@deepseek-ai/dsh-subprocess` (a provider such as `dsh-subprocess-local`), `@deepseek-ai/dsh-tools`, a credential provider such as `@deepseek-ai/dsh-credentials-local`, and `@deepseek-ai/dsh-assessment-scope-tool-policy` configured with `credentialTools` including `sts_get_caller_identity` and `cloudTools` including `iam_enum` and `s3_enum`. The `aws` executable must be resolvable on the execution host's PATH or via `config.command`. The grant must declare a `cloud` target (provider `aws`, the account id as the target value), list the mapped actions, and carry a `credentials` entry pairing the presented reference with that target. All three tools are read-only List/Get/STS calls; read API requests still count against the account's request quota.

The credential secret format is `KEY=VALUE` lines restricted to `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and the optional `AWS_SESSION_TOKEN`; both the key id and secret are required, and unsupported keys fail the call at execution time.

<a id="model-experience"></a>
## Model Experience

### sts_get_caller_identity tool schema

#### What the model sees

The model receives the generated [`sts_get_caller_identity` schema](../../../docs/tool-catalog.md#cinlantool-aws): `target_id` (required account id matching a cloud grant target), `credential_ref` (required, an environment-variable-shaped name — the value never enters the conversation), plus optional `region` (must fall inside the target's declared region allowlist).

### iam_enum tool schema

#### What the model sees

The model receives the generated [`iam_enum` schema](../../../docs/tool-catalog.md#cinlantool-aws): `target_id` (required), `resource` (required, one of `users`, `roles`, `policies` — policies are scoped to account-local), `limit` (optional `--max-items`, default 100), optional `credential_ref` (injected as subprocess environment entries; without it the local AWS configuration chain supplies the credentials), plus optional `region`.

### s3_enum tool schema

#### What the model sees

The model receives the generated [`s3_enum` schema](../../../docs/tool-catalog.md#cinlantool-aws): `target_id` (required), optional `credential_ref` (injected as subprocess environment entries; without it the local AWS configuration chain supplies the credentials), optional `region`, and optional `public_status` (per-bucket `get-bucket-policy-status`, which requires an explicit region because the check is region-scoped).

### iam_policy_attach tool schema

#### What the model sees

The model receives the generated [`iam_policy_attach` schema](../../../docs/tool-catalog.md#cinlantool-aws): `target_id`, `policy_arn` (an existing managed-policy ARN — no policy document is ever composed), `username`, optional `credential_ref`, and optional `region`, with the first three required. Grants that list `persistence-change` in `approvalRequiredActions` turn every call into an approval prompt.

### iam_policy_detach tool schema

#### What the model sees

The model receives the generated [`iam_policy_detach` schema](../../../docs/tool-catalog.md#cinlantool-aws): the same parameter set as `iam_policy_attach`; it rolls the grant back. Detaching a policy that is not attached fails with a clear CLI error.

#### Token effect

The tools add five descriptions and JSON schemas to the model tool context; results are byte-bounded by `maxOutputBytes` (default 256 KiB).

#### KV Cache effect

The tool schemas are part of the model tool prefix and remain cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Requires a local AWS CLI v2 installation; the tool reports a clear error when the executable is missing.
- The credential secret rides in the subprocess environment, which the same local user can read through process-environment inspection during execution — but it never appears in model-visible arguments, results, or the Session log.
- The `s3_enum` public-policy check is region-scoped: buckets outside the passed `region` report as `unknown`, and buckets beyond `maxPublicChecks` (default 20) report as `skipped`.
- AWS IAM is a global service; the optional `region` flag affects only endpoint routing, not the resource scope of `list-users` / `list-roles` / `list-policies`.
- Write-path AWS tools (resource mutation, privilege escalation paths) are deferred: this package is enumeration and identity confirmation only.

<a id="dev-note"></a>
### Dev Note

Keep the tool names, the `credential_ref` parameter name, the `credentialTools`/`cloudTools` wiring, and the `cloud` target shape synchronized with `assessment-scope-tool-policy` and the security-research bundle patch.
