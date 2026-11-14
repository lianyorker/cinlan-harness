---
description: "Model-facing BloodHound directory collection tool for authorized assessments."
kind: "package-reference"
---
# @cinlan/tool-bloodhound

English | [中文](README.zh.md)

## Summary
This package registers the `bloodhound_enum` tool on `ctx.tools`. It shells out to a locally installed `bloodhound-python` binary through `ctx.subprocess`, collects into a private temporary directory, aggregates the collector JSON files into a triage summary (per-collector counts plus the Kerberoastable and AS-REP Roastable account lists), and removes the directory afterwards. The account secret is resolved from the model-provided `credential_ref` at execution time through `ctx.get('credentials')` and never appears in model-visible arguments, tool results, or the Session log. Authorization is enforced upstream by `assessment-scope-tool-policy` under the `credential-use` action.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount with `@deepseek-ai/dsh-subprocess` (a provider such as `dsh-subprocess-local`), `@deepseek-ai/dsh-tools`, a credential provider such as `@deepseek-ai/dsh-credentials-local`, and `@deepseek-ai/dsh-assessment-scope-tool-policy` configured with `credentialTools` including `bloodhound_enum`. The `bloodhound-python` executable must be resolvable on the execution host's PATH or via `config.command`. The grant must list the `credential-use` action and a `credentials` entry pairing the presented reference with the collected domain.

<a id="model-experience"></a>
## Model Experience

### bloodhound_enum tool schema

#### What the model sees

The model receives the generated [`bloodhound_enum` schema](../../../docs/tool-catalog.md#cinlantool-bloodhound): `target_id` (required domain matching a grant target), `username` (required), `credential_ref` (required, an environment-variable-shaped name — the value never enters the conversation), and an optional `nameserver` for `-ns`.

#### Token effect

The tool adds one description and JSON schema to the model tool context; results are byte-bounded by `maxOutputBytes` (default 256 KiB).

#### KV Cache effect

The tool schema is part of the model tool prefix and remains cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Requires a local `bloodhound-python` installation; the tool reports a clear error when the executable is missing.
- The summary extracts per-collector counts and the roastable-account lists from `users.json`; it is a triage view, not a graph query interface — the full attack-path graph stays in the collector JSON, which this tool deletes after aggregation.
- bloodhound-python output shape varies across versions; the aggregator accepts both the plain-array and `{"data": [...]}` document shapes and skips unparseable files.
- The secret rides on the `-p` flag, so it is visible in the local process list during execution — but never in model-visible arguments, results, or the Session log.
- egress is not constructed for these calls; authorization relies on the target, the `credential-use` action, and the granted credential reference together.

<a id="dev-note"></a>
### Dev Note

Keep the tool name `bloodhound_enum`, the `credential_ref` parameter name, and the `credentialTools` wiring synchronized with `assessment-scope-tool-policy` and the security-research bundle patch.
