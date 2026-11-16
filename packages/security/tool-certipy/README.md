---
description: "Model-facing ADCS collection tool for authorized assessments."
kind: "package-reference"
---
# @cinlan/tool-certipy

English | [中文](README.zh.md)

## Summary
This package registers the `adcs_find`, `adcs_req`, and `adcs_auth` tools on `ctx.tools`. `adcs_find` collects ADCS configuration with fixed `-stdout` JSON; the ESC exploitation pair (`adcs_req` requesting a certificate through an ESC path, `adcs_auth` authenticating with the resulting PFX artifact) completes the chain under the `exploit-execution` action. The account secret is resolved from the model-provided `credential_ref` at execution time through `ctx.get('credentials')` and never appears in model-visible arguments, tool results, or the Session log. Authorization is enforced upstream by `assessment-scope-tool-policy`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount with `@deepseek-ai/dsh-subprocess` (a provider such as `dsh-subprocess-local`), `@deepseek-ai/dsh-tools`, a credential provider such as `@deepseek-ai/dsh-credentials-local`, and `@deepseek-ai/dsh-assessment-scope-tool-policy` configured with `credentialTools` including `adcs_find`. The `certipy` executable must be resolvable on the execution host's PATH or via `config.command`. The grant must list the `credential-use` action and a `credentials` entry pairing the presented reference with the collected domain.

<a id="model-experience"></a>
## Model Experience

### adcs_find tool schema

#### What the model sees

The model receives the generated [`adcs_find` schema](../../../docs/tool-catalog.md#cinlantool-certipy): `target_id` (required domain matching a grant target), `username` (required), `credential_ref` (required, an environment-variable-shaped name — the value never enters the conversation), plus optional `dc_ip` and `vulnerable_only` (the `-vulnerable` filter for ESC-class escalation paths).

### adcs_req tool schema

#### What the model sees

The model receives the generated [`adcs_req` schema](../../../docs/tool-catalog.md#cinlantool-certipy): `target_id`, `username`, `credential_ref`, `ca` and `template` (all required, names as `adcs_find` reported them), plus optional `san` (ESC1 Subject Alternative Name) and `dc_ip`. The result carries the PFX artifact path plus certipy's bounded summary lines.

### adcs_auth tool schema

#### What the model sees

The model receives the generated [`adcs_auth` schema](../../../docs/tool-catalog.md#cinlantool-certipy): `target_id` and `pfx_path` (required, the artifact path from `adcs_req`), plus optional `dc_ip`. The result carries certipy's authentication summary lines (TGT or NT hash).

#### Token effect

The tools add three descriptions and JSON schemas to the model tool context; results are byte-bounded by `maxOutputBytes` (default 256 KiB).

#### KV Cache effect

The tool schemas are part of the model tool prefix and remain cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Requires a local `certipy` (certipy-adt) installation; the tool reports a clear error when the executable is missing.
- The parser extracts row names from the `CAs`/`Templates` JSON lists; ESC-class detail beyond names stays in the raw stdout the caller can re-run for, and template-property drift across certipy versions yields shorter rows rather than failures.
- The secret rides on the `-p` flag of `adcs_find` and `adcs_req`, so it is visible in the local process list during execution — but never in model-visible arguments, results, or the Session log.
- The `adcs_req` PFX artifact is a binary mechanism product, not a tool-result export: it writes into a private temporary directory whose lifetime follows the host process; the caller chains it into `adcs_auth` within the same session.
- Golden-certificate forging (`certipy forge`) and CA management operations (`certipy ca`, `certipy template`, `certipy shadow`) are deferred: this package covers collection plus the request-and-authenticate exploitation chain.

<a id="dev-note"></a>
### Dev Note

Keep the tool name `adcs_find`, the `credential_ref` parameter name, and the `credentialTools` wiring synchronized with `assessment-scope-tool-policy` and the security-research bundle patch.
