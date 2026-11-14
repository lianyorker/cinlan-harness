---
description: "Model-facing masscan SYN rate-scan tool for authorized assessments."
kind: "package-reference"
---
# @cinlan/tool-masscan

English | [中文](README.zh.md)

## Summary
This package registers the `masscan_scan` tool on `ctx.tools`. It shells out to a locally installed `masscan` binary through `ctx.subprocess`, parses `-oJ -` streamed JSON (including truncated arrays) into bounded structured open-port rows, and never emits file-output, exclude-file, or list-file arguments. The scan rate is bounded by the model-side `1..1000000` validation and the deployment `maxRate` cap. Authorization is enforced upstream by `assessment-scope-tool-policy`: `target_id` must match a target declared in the active assessment-scope grant, and the tool name must be listed in that policy's `networkTools`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount with `@deepseek-ai/dsh-subprocess` (a provider such as `dsh-subprocess-local`), `@deepseek-ai/dsh-tools`, and `@deepseek-ai/dsh-assessment-scope-tool-policy` configured with `networkTools` including `masscan_scan`. The `masscan` binary must be resolvable on the execution host's PATH or via `config.command`. Set `config.maxRate` to the deployment's acceptable packets-per-second ceiling; the model-selected `rate` cannot exceed it.

<a id="model-experience"></a>
## Model Experience

### masscan_scan tool schema

#### What the model sees

The model receives the generated [`masscan_scan` schema](../../../docs/tool-catalog.md#cinlantool-masscan): `target_id` (required IP/CIDR/range matching a grant target), optional `ports` (`-p` digits/commas/hyphens), and optional `rate` (`--rate`, integer, default 100, bounded by `maxRate`).

#### Token effect

The tool adds one scan description and JSON schema to the model tool context; results are byte-bounded by `maxOutputBytes` (default 256 KiB).

#### KV Cache effect

The tool schema is part of the model tool prefix and remains cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Requires a local `masscan` installation with raw-packet privileges (root/administrator on most platforms); the tool reports a clear error when the executable is missing or the scan fails.
- `-oJ` streams the JSON array without a closing bracket when the run is cut off; the parser drops the incomplete trailing object rather than reporting a possibly truncated port number.
- No service/version probing: masscan discovers open ports only, and this tool intentionally exposes no banner-grab or script flags.
- CIDR/range targets must be declared verbatim as grant target values; the scope policy performs exact/prefix matching, not CIDR containment.
- A completed scan is evidence for triage, not proof of exploitability or an authorization grant.

<a id="dev-note"></a>
### Dev Note

Keep the tool name `masscan_scan`, the `target_id` parameter name, the fixed `-oJ -` output flag, and the `networkTools` wiring synchronized with `assessment-scope-tool-policy` and the security-research bundle patch.
