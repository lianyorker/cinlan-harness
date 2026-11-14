---
description: "Model-facing nxc (NetExec) password-spray tool for authorized assessments."
kind: "package-reference"
---
# @cinlan/tool-nxc

English | [中文](README.zh.md)

## Summary
This package registers the `nxc_spray` tool on `ctx.tools`. It shells out to a locally installed `nxc` (NetExec) binary through `ctx.subprocess` with fixed `--continue-on-success --no-banner` flags and parses hit lines into bounded structured rows with the secret scrubbed from every stored line. The account secret is resolved from the model-provided `credential_ref` at execution time through `ctx.get('credentials')` and never appears in model-visible arguments, tool results, or the Session log. Authorization is enforced upstream by `assessment-scope-tool-policy` under the `credential-use` action.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount with `@deepseek-ai/dsh-subprocess` (a provider such as `dsh-subprocess-local`), `@deepseek-ai/dsh-tools`, a credential provider such as `@deepseek-ai/dsh-credentials-local`, and `@deepseek-ai/dsh-assessment-scope-tool-policy` configured with `credentialTools` including `nxc_spray`. The `nxc` executable must be resolvable on the execution host's PATH or via `config.command`; set `config.maxThreads` to the deployment's acceptable worker ceiling. The grant must list the `credential-use` action and a `credentials` entry pairing the presented reference with the sprayed target.

<a id="model-experience"></a>
## Model Experience

### nxc_spray tool schema

#### What the model sees

The model receives the generated [`nxc_spray` schema](../../../docs/tool-catalog.md#cinlantool-nxc): `target_id` (required host matching a grant target), `usernames` (required list of 1-100 candidate account names), `credential_ref` (required, an environment-variable-shaped name — the value never enters the conversation), plus optional `protocol` (smb default; ldap, mssql, winrm, ssh), `domain`, and `threads` bounded by `maxThreads`.

#### Token effect

The tool adds one description and JSON schema to the model tool context; results are byte-bounded by `maxOutputBytes` (default 256 KiB).

#### KV Cache effect

The tool schema is part of the model tool prefix and remains cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Requires a local NetExec installation; the tool reports a clear error when the executable is missing.
- nxc echoes the secret inside successful hit lines; the parser scrubs every occurrence of the resolved secret from stored lines, so hit rows carry account names and redacted lines only.
- The secret rides on the `-p` flag, so it is visible in the local process list during execution — but never in model-visible arguments, results, or the Session log.
- Account lockout policy is the engagement's responsibility: the tool sends one password to each candidate account per call with the configured thread count; schedule sprays against lockout windows.
- egress is not constructed for these calls; authorization relies on the target, the `credential-use` action, and the granted credential reference together.

<a id="dev-note"></a>
### Dev Note

Keep the tool name `nxc_spray`, the `credential_ref` parameter name, and the `credentialTools` wiring synchronized with `assessment-scope-tool-policy` and the security-research bundle patch.
