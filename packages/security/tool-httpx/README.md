---
description: "Model-facing httpx web-service probe tool for authorized assessments."
kind: "package-reference"
---
# @cinlan/tool-httpx

English | [中文](README.zh.md)

## Summary
This package registers the `httpx_probe` tool on `ctx.tools`. It shells out to a locally installed `httpx` binary through `ctx.subprocess`, parses `-json` output into bounded structured rows (URL, status code, title, technologies, web server, CDN), and always emits `-no-color -silent`. Authorization is enforced upstream by `assessment-scope-tool-policy`: each `target_id` must match a target declared in the active assessment-scope grant, and the tool name must be listed in that policy's `networkTools`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount with `@deepseek-ai/dsh-subprocess` (a provider such as `dsh-subprocess-local`), `@deepseek-ai/dsh-tools`, and `@deepseek-ai/dsh-assessment-scope-tool-policy` configured with `networkTools` including `httpx_probe`. The `httpx` binary must be resolvable on the execution host's PATH or via `config.command`.

<a id="model-experience"></a>
## Model Experience

### httpx_probe tool schema

#### What the model sees

The model receives the generated [`httpx_probe` schema](../../../docs/tool-catalog.md#cinlantool-httpx): `target_id` (required, whitespace/comma-separated targets that must match grant targets, at most 1000), optional `statusCode`, `title`, `techDetect`, `followRedirects`, `https`, and `http` scheme toggles. Results are live-service rows; only the first 50 rows appear in the rendered text card.

#### Token effect

The tool adds one probe description and JSON schema to the model tool context; the complete JSON result is byte-bounded by `maxOutputBytes` (default 256 KiB).

#### KV Cache effect

The tool schema is part of the model tool prefix and remains cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Requires a local `httpx` installation; the tool reports a clear error when the executable is missing.
- No fuzzing or payload injection: the tool probes liveness and metadata only.
- Subprocess stdout is capped at 32 MiB before parsing; runs producing more output are truncated and may lose rows.
- A completed probe is evidence for triage, not proof of exploitability or an authorization grant.

<a id="dev-note"></a>
### Dev Note

Keep the tool name `httpx_probe`, the `target_id` parameter name, and the `networkTools` wiring synchronized with `assessment-scope-tool-policy` and the security-research bundle patch.
