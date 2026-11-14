---
description: "Model-facing impacket domain-credential tools for authorized assessments."
kind: "package-reference"
---
# @cinlan/tool-impacket

English | [中文](README.zh.md)

## Summary
This package registers the `kerberoast`, `asrep_roast`, and `secrets_dump` tools on `ctx.tools`. Each shells out to a locally installed impacket binary through `ctx.subprocess` and parses hash or credential rows into bounded structured output. The account secret is resolved from the model-provided `credential_ref` at execution time through `ctx.get('credentials')` and never appears in model-visible arguments, tool results, or the Session log. Authorization is enforced upstream by `assessment-scope-tool-policy`: the tool name must be listed in that policy's `credentialTools`, the call must carry a well-formed `credential_ref`, `target_id` must match a grant target, and the mapped `credential-use` action must be granted — with the presented reference — for that target.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount with `@deepseek-ai/dsh-subprocess` (a provider such as `dsh-subprocess-local`), `@deepseek-ai/dsh-tools`, a credential provider such as `@deepseek-ai/dsh-credentials-local`, and `@deepseek-ai/dsh-assessment-scope-tool-policy` configured with `credentialTools` including all three tool names. The impacket executables must be resolvable on the execution host's PATH or via the per-tool config commands (`keroboastCommand`, `asreproastCommand`, `secretsdumpCommand`). The grant must list the `credential-use` action and a `credentials` entry pairing the presented reference with each sprayed or dumped target.

<a id="model-experience"></a>
## Model Experience

### kerberoast, asrep_roast, and secrets_dump tool schemas

#### What the model sees

The model receives the generated [`keroboast` schema](../../../docs/tool-catalog.md#cinlantool-impacket) (and the sibling `asrep_roast`/`secrets_dump` schemas): `target_id` (required), `username` (required), `credential_ref` (required, an environment-variable-shaped name — the value never enters the conversation), plus optional `dc_ip`; `secrets_dump` adds a required `domain` and an optional `just_dc` switch for directory DRSUAPI dumps.

#### Token effect

The tools add three descriptions and JSON schemas to the model tool context; results are byte-bounded by `maxOutputBytes` (default 256 KiB).

#### KV Cache effect

The tool schemas are part of the model tool prefix and remain cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Requires local impacket installations; each tool reports a clear error when its executable is missing.
- The secret rides inside impacket's `domain/user:password` target argument, so it is visible in the local process list during execution — but never in model-visible arguments, results, or the Session log.
- `secrets_dump` returns hash values by default (`redactionLevel: 'full'`) so they can feed offline cracking; set `redactionLevel: 'masked'` to replace every hash with `[redacted]`.
- egress is not constructed for these calls; authorization relies on the target, the `credential-use` action, and the granted credential reference together.
- Kerberos ticket handling (ccache), delegation attacks, and ADCS tooling (certipy, rbcd) are deferred to later batches.

<a id="dev-note"></a>
### Dev Note

Keep the tool names, the `credential_ref` parameter name, and the `credentialTools` wiring synchronized with `assessment-scope-tool-policy` and the security-research bundle patch.
