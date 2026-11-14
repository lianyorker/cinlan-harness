---
description: "Model-facing passive subdomain enumeration tool for authorized assessments."
kind: "package-reference"
---
# @cinlan/tool-subfinder

English | [中文](README.zh.md)

## Summary
This package registers the `subfinder_enum` tool on `ctx.tools`. It shells out to a locally installed `subfinder` binary through `ctx.subprocess`, parses `-json` output into bounded structured rows (hostname, data source, resolved addresses), and performs purely passive enumeration: subfinder queries third-party data sources and DNS, not the target's own services. Authorization is enforced upstream by `assessment-scope-tool-policy`: the `target_id` domain must match a target declared in the active assessment-scope grant, and the tool name must be listed in that policy's `networkTools`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount with `@deepseek-ai/dsh-subprocess` (a provider such as `dsh-subprocess-local`), `@deepseek-ai/dsh-tools`, and `@deepseek-ai/dsh-assessment-scope-tool-policy` configured with `networkTools` including `subfinder_enum`. The `subfinder` binary must be resolvable on the execution host's PATH or via `config.command`; passive data-source API keys, when used, come from subfinder's own provider configuration.

<a id="model-experience"></a>
## Model Experience

### subfinder_enum tool schema

#### What the model sees

The model receives the generated [`subfinder_enum` schema](../../../docs/tool-catalog.md#cinlantool-subfinder): `target_id` (required, one root domain that must match a grant target), optional `resolve` (`-resolve`) and `active` (`-active`). Results are deduplicated subdomain rows; only the first 50 rows appear in the rendered text card.

#### Token effect

The tool adds one enumeration description and JSON schema to the model tool context; the complete JSON result is byte-bounded by `maxOutputBytes` (default 256 KiB).

#### KV Cache effect

The tool schema is part of the model tool prefix and remains cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Requires a local `subfinder` installation; the tool reports a clear error when the executable is missing.
- Coverage depends on the configured passive data sources; enumeration completeness is not guaranteed.
- Subprocess stdout is capped at 32 MiB before parsing; runs producing more output are truncated and may lose rows.
- A completed enumeration is evidence for attack-surface mapping, not proof that discovered hosts are in scope; each host must be validated against the grant before further tool use.

<a id="dev-note"></a>
### Dev Note

Keep the tool name `subfinder_enum`, the `target_id` parameter name, and the `networkTools` wiring synchronized with `assessment-scope-tool-policy` and the security-research bundle patch.
