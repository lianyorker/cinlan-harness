---
description: "Model-facing katana URL-crawl tool for authorized assessments."
kind: "package-reference"
---
# @cinlan/tool-katana

English | [中文](README.zh.md)

## Summary
This package registers the `katana_crawl` tool on `ctx.tools`. It shells out to a locally installed `katana` binary through `ctx.subprocess` with fixed `-json -silent -no-color` output flags, parses the line-delimited JSON into bounded structured discovery rows, and never emits output-file, exclude-file, or out-of-band callback arguments. Depth is bounded to `1..5` and concurrency by the deployment `maxConcurrency` cap. Authorization is enforced upstream by `assessment-scope-tool-policy`: the `target_id` URL host must match a target declared in the active assessment-scope grant, and the tool name must be listed in that policy's `networkTools`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount with `@deepseek-ai/dsh-subprocess` (a provider such as `dsh-subprocess-local`), `@deepseek-ai/dsh-tools`, and `@deepseek-ai/dsh-assessment-scope-tool-policy` configured with `networkTools` including `katana_crawl`. The `katana` binary must be resolvable on the execution host's PATH or via `config.command`. Set `config.maxConcurrency` to the deployment's acceptable worker ceiling; the model-selected `concurrency` cannot exceed it.

<a id="model-experience"></a>
## Model Experience

### katana_crawl tool schema

#### What the model sees

The model receives the generated [`katana_crawl` schema](../../../docs/tool-catalog.md#cinlantool-katana): `target_id` (required absolute http(s) URL whose host matches a grant target), optional `depth` (`-d`, 1..5, default 3), and optional `concurrency` (`-c`, bounded by `maxConcurrency`).

#### Token effect

The tool adds one crawl description and JSON schema to the model tool context; results are byte-bounded by `maxOutputBytes` (default 256 KiB).

#### KV Cache effect

The tool schema is part of the model tool prefix and remains cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Requires a local `katana` installation; the tool reports a clear error when the executable is missing.
- The crawler actively requests the granted host: the scope policy authorizes the URL host, and the crawl stays on that target's surface, but dynamically discovered off-host URLs may be requested by katana itself before filtering — grant the host with that in mind.
- No payload or exploitation flags are exposed; this is a discovery crawler, not a DAST scanner.
- JavaScript-rendered discovery depends on the installed katana build's runtime support; no browser is mounted by this package.

<a id="dev-note"></a>
### Dev Note

Keep the tool name `katana_crawl`, the `target_id` parameter name, the fixed `-json -silent -no-color` output flags, and the `networkTools` wiring synchronized with `assessment-scope-tool-policy` and the security-research bundle patch.
