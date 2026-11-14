---
description: "Model-facing passive known-URL fetch tool for authorized assessments."
kind: "package-reference"
---
# @cinlan/tool-gau

English | [中文](README.zh.md)

## Summary
This package registers the `gau_urls` tool on `ctx.tools`. It shells out to a locally installed `gau` binary through `ctx.subprocess` with fixed `--json --subs` flags, parses the mixed JSON-record/plain-line output into bounded deduplicated URL rows, and never emits output-file arguments. The run is fully passive: gau queries third-party historical archives (wayback, commoncrawl, otx, urlscan) and never contacts the target domain itself. Authorization is enforced upstream by `assessment-scope-tool-policy`: `target_id` must match a domain declared in the active assessment-scope grant, and the tool name must be listed in that policy's `networkTools`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount with `@deepseek-ai/dsh-subprocess` (a provider such as `dsh-subprocess-local`), `@deepseek-ai/dsh-tools`, and `@deepseek-ai/dsh-assessment-scope-tool-policy` configured with `networkTools` including `gau_urls`. The `gau` binary must be resolvable on the execution host's PATH or via `config.command`.

<a id="model-experience"></a>
## Model Experience

### gau_urls tool schema

#### What the model sees

The model receives the generated [`gau_urls` schema](../../../docs/tool-catalog.md#cinlantool-gau): `target_id` (required domain matching a grant target) and optional `providers` (subset of `wayback`, `commoncrawl`, `otx`, `urlscan`; omitted means all sources).

#### Token effect

The tool adds one fetch description and JSON schema to the model tool context; results are byte-bounded by `maxOutputBytes` (default 256 KiB).

#### KV Cache effect

The tool schema is part of the model tool prefix and remains cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Requires a local `gau` installation; the tool reports a clear error when the executable is missing.
- `--json` output shape varies across gau versions (JSON records or plain URL lines); the parser accepts both and cannot distinguish record metadata beyond the `url` field.
- Archived URLs are historical: they may be stale, offline, or no longer authorized surfaces — treat results as leads to re-verify against the current grant, never as live targets.
- Result volume for large domains can be high; the tool truncates rendering at 50 rows and bounds the serialized result by `maxOutputBytes`.

<a id="dev-note"></a>
### Dev Note

Keep the tool name `gau_urls`, the `target_id` parameter name, the fixed `--json --subs` flags, the provider whitelist, and the `networkTools` wiring synchronized with `assessment-scope-tool-policy` and the security-research bundle patch.
