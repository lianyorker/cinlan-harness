---
description: "Model-facing read-only GCP tools for authorized cloud assessments."
kind: "package-reference"
---
# @cinlan/tool-gcp

English | [中文](README.zh.md)

## Summary
This package registers the `gcp_identity_get`, `gcp_iam_enum`, `gcs_enum`, `gcs_bucket_iam`, `iam_binding_add`, and `iam_binding_remove` tools on `ctx.tools`. It shells out to a locally installed gcloud CLI through `ctx.subprocess` with fixed `--format=json` flags and explicit `--project` arguments, parses the JSON into bounded rows, and never emits output-file arguments. The service-account JSON is resolved from the model-provided `credential_ref` at execution time through `ctx.get('credentials')`, validated as service-account JSON, written to a private temporary file (mode 0600), and exposed to gcloud only through the `CLOUDSDK_AUTH_CREDENTIALS_FILE_OVERRIDE` environment variable; the file is deleted when the call finishes. The secret never appears in argv, model-visible arguments, tool results, or the Session log. Authorization is enforced upstream by `assessment-scope-tool-policy`: `gcp_identity_get` under the `credential-use` action, `gcp_iam_enum`, `gcs_enum`, and `gcs_bucket_iam` under the `reconnaissance` action through `cloudTools`, and the binding pair under the `persistence-change` action through `cloudWriteTools`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount with `@deepseek-ai/dsh-subprocess` (a provider such as `dsh-subprocess-local`), `@deepseek-ai/dsh-tools`, a credential provider such as `@deepseek-ai/dsh-credentials-local`, and `@deepseek-ai/dsh-assessment-scope-tool-policy` configured with `credentialTools` including `gcp_identity_get` and `cloudTools` including `gcp_iam_enum` and `gcs_enum`. The `gcloud` executable must be resolvable on the execution host's PATH or via `config.command`. The grant must declare a `cloud` target (provider `gcp`, the account id as the target value) with a `projects` allowlist, list the mapped actions, and carry a `credentials` entry pairing the presented reference with that target. All three tools are read-only calls; read API requests still count against the project's quota.

The credential secret is the service-account JSON document itself; anything other than JSON with `type: 'service_account'` fails at execution time. Every tool call requires `credential_ref` because gcloud needs an identity file for each call.

<a id="model-experience"></a>
## Model Experience

### gcp_identity_get tool schema

#### What the model sees

The model receives the generated [`gcp_identity_get` schema](../../../docs/tool-catalog.md#cinlantool-gcp): `target_id` (required account id matching a cloud grant target), `project` (required, inside the target's project allowlist), and `credential_ref` (required, an environment-variable-shaped name — the value never enters the conversation).

### gcp_iam_enum tool schema

#### What the model sees

The model receives the generated [`gcp_iam_enum` schema](../../../docs/tool-catalog.md#cinlantool-gcp): `target_id`, `project`, and `credential_ref`, all required. Results are role-binding rows with their member lists.

### gcs_enum tool schema

#### What the model sees

The model receives the generated [`gcs_enum` schema](../../../docs/tool-catalog.md#cinlantool-gcp): `target_id`, `project`, and `credential_ref`, all required. Results are bucket rows carrying each bucket's `publicAccessPrevention` setting — `enforced` blocks public exposure, `inherited` does not.

### gcs_bucket_iam tool schema

#### What the model sees

The model receives the generated [`gcs_bucket_iam` schema](../../../docs/tool-catalog.md#cinlantool-gcp): `target_id`, `credential_ref`, and `bucket` (a bucket name reported by `gcs_enum`, without the `gs://` scheme), all required. Results are the bucket's IAM role-binding rows plus a `public` flag that reports whether an anonymous principal (`allUsers` / `allAuthenticatedUsers`) holds any role.

### iam_binding_add tool schema

#### What the model sees

The model receives the generated [`iam_binding_add` schema](../../../docs/tool-catalog.md#cinlantool-gcp): `target_id`, `project`, `member` (`user:<email>` / `serviceAccount:<email>` / `group:<email>` / `domain:<domain>`), `role` (an existing `roles/<name>` — no policy document is ever composed), and `credential_ref`, all required. Grants that list `persistence-change` in `approvalRequiredActions` turn every call into an approval prompt.

### iam_binding_remove tool schema

#### What the model sees

The model receives the generated [`iam_binding_remove` schema](../../../docs/tool-catalog.md#cinlantool-gcp): the same parameter set as `iam_binding_add`; it rolls the binding back. Removing a binding that does not exist fails with a clear CLI error.

#### Token effect

The tools add six descriptions and JSON schemas to the model tool context; results are byte-bounded by `maxOutputBytes` (default 256 KiB).

#### KV Cache effect

The tool schemas are part of the model tool prefix and remain cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Requires a local gcloud CLI installation; the tool reports a clear error when the executable is missing.
- The credential file rides in a private temporary directory that the same local user can read during execution — but the secret never appears in argv, model-visible arguments, results, or the Session log, and the directory is deleted after every call.
- gcloud reads the operator's local configuration for default project and region values; this package sets explicit project arguments on every call, but other ambient defaults (account, quota project) still come from the local configuration.
- `gcs_enum` reports the public-access-prevention setting; the per-bucket IAM dump is the separate `gcs_bucket_iam` tool.
- Write-path GCP tools (IAM mutation, resource creation) are deferred: this package is enumeration and identity confirmation only.

<a id="dev-note"></a>
### Dev Note

Keep the tool names, the `credential_ref` parameter name, the `credentialTools`/`cloudTools` wiring, and the `cloud` target shape synchronized with `assessment-scope-tool-policy` and the security-research bundle patch.
