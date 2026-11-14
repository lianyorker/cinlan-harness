---
description: "Model-facing naabu fast port-scan tool for authorized assessments."
kind: "package-reference"
---
# @cinlan/tool-naabu

English | [中文](README.zh.md)

## Summary
This package registers the `naabu_scan` tool on `ctx.tools`. It shells out to a locally installed `naabu` binary through `ctx.subprocess`, parses `-json` output into bounded structured open-port rows (host, IP, port), and always emits `-silent -exclude-cdn`. Service identification is out of scope — the tool discovers open ports only. Authorization is enforced upstream by `assessment-scope-tool-policy`: each `target_id` must match a target declared in the active assessment-scope grant, and the tool name must be listed in that policy's `networkTools`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount with `@deepseek-ai/dsh-subprocess` (a provider such as `dsh-subprocess-local`), `@deepseek-ai/dsh-tools`, and `@deepseek-ai/dsh-assessment-scope-tool-policy` configured with `networkTools` including `naabu_scan`. The `naabu` binary must be resolvable on the execution host's PATH or via `config.command`; SYN scanning needs elevated privileges on most platforms.

<a id="model-experience"></a>
## Model Experience

### naabu_scan tool schema

#### What the model sees

The model receives the generated [`naabu_scan` schema](../../../docs/tool-catalog.md#cinlantool-naabu): `target_id` (required, whitespace/comma-separated targets that must match grant targets, at most 1000), plus `ports` (`-p`) or `topPorts` (`-top-ports`), which are mutually exclusive. Results are open-port rows; only the first 50 rows appear in the rendered text card.

#### Token effect

The tool adds one scan description and JSON schema to the model tool context; the complete JSON result is byte-bounded by `maxOutputBytes` (default 256 KiB).

#### KV Cache effect

The tool schema is part of the model tool prefix and remains cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Requires a local `naabu` installation; the tool reports a clear error when the executable is missing.
- No service or version fingerprinting: pair with `nmap_scan -sV` when service names are needed.
- SYN scanning requires elevated privileges on most platforms; connect-mode fallback behavior is naabu's own.
- CIDR targets must be declared verbatim as grant target values; the scope policy performs exact/prefix matching, not CIDR containment.
- A completed scan is evidence for triage, not proof of exploitability or an authorization grant.

<a id="dev-note"></a>
### Dev Note

Keep the tool name `naabu_scan`, the `target_id` parameter name, and the `networkTools` wiring synchronized with `assessment-scope-tool-policy` and the security-research bundle patch.
