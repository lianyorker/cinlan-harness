---
description: "Model-facing nmap port-scan tool for authorized assessments."
kind: "package-reference"
---
# @cinlan/tool-nmap

English | [中文](README.zh.md)

## Summary
This package registers the `nmap_scan` tool on `ctx.tools`. It shells out to a locally installed `nmap` binary through `ctx.subprocess`, parses `-oX -` XML output into bounded structured host/port/service rows, and never emits `--script` arguments. Authorization is enforced upstream by `assessment-scope-tool-policy`: `target_id` must match a target declared in the active assessment-scope grant, and the tool name must be listed in that policy's `networkTools`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount with `@deepseek-ai/dsh-subprocess` (a provider such as `dsh-subprocess-local`), `@deepseek-ai/dsh-tools`, and `@deepseek-ai/dsh-assessment-scope-tool-policy` configured with `networkTools` including `nmap_scan`. The `nmap` binary must be resolvable on the execution host's PATH or via `config.command`.

<a id="model-experience"></a>
## Model Experience

### nmap_scan tool schema

#### What the model sees

The model receives the generated [`nmap_scan` schema](../../../docs/tool-catalog.md#cinlantool-nmap): `target_id` (required, must match a grant target), optional `ports`/`topPorts`, `serviceDetection` (`-sV`), `osDetection` (`-O`), `openOnly` (default true), and `timing` (`-T0`..`-T5`).

#### Token effect

The tool adds one scan description and JSON schema to the model tool context; results are byte-bounded by `maxOutputBytes` (default 256 KiB).

#### KV Cache effect

The tool schema is part of the model tool prefix and remains cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Requires a local `nmap` installation; the tool reports a clear error when the executable is missing.
- No `--script` support: NSE vulnerability scripts are intentionally out of scope for this reconnaissance tool.
- OS detection (`-O`) needs elevated privileges on most platforms and may fail on unprivileged hosts.
- CIDR targets must be declared verbatim as grant target values; the scope policy performs exact/prefix matching, not CIDR containment.
- A completed scan is evidence for triage, not proof of exploitability or an authorization grant.

<a id="dev-note"></a>
### Dev Note

Keep the tool name `nmap_scan`, the `target_id` parameter name, and the `networkTools` wiring synchronized with `assessment-scope-tool-policy` and the security-research bundle patch.
