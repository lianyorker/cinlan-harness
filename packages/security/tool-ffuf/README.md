---
description: "Model-facing ffuf directory/parameter fuzz tool for authorized assessments."
kind: "package-reference"
---
# @cinlan/tool-ffuf

English | [中文](README.zh.md)

## Summary
This package registers the `ffuf_fuzz` tool on `ctx.tools`. It shells out to a locally installed `ffuf` binary through `ctx.subprocess`, parses `-json` stdout into bounded match rows (keyword, URL, status, length), and always emits `-json -s` with `-ac` auto-calibration on by default; no aggressive rate flags are emitted. Authorization is enforced upstream by `assessment-scope-tool-policy`: the fuzz URL's host must match a target declared in the active assessment-scope grant, and the tool name must be listed in that policy's `networkTools`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount with `@deepseek-ai/dsh-subprocess` (a provider such as `dsh-subprocess-local`), `@deepseek-ai/dsh-tools`, and `@deepseek-ai/dsh-assessment-scope-tool-policy` configured with `networkTools` including `ffuf_fuzz`. The `ffuf` binary and the wordlist files passed as arguments must exist on the execution host; the tool validates wordlist paths only against injection, not existence.

<a id="model-experience"></a>
## Model Experience

### ffuf_fuzz tool schema

#### What the model sees

The model receives the generated [`ffuf_fuzz` schema](../../../docs/tool-catalog.md#cinlantool-ffuf): `url` (required, must contain the literal `FUZZ` keyword, http/https scheme enforced) and `wordlist` (required file path), plus optional `method` (`-X`), `matchCodes` (`-mc`), `autoCalibrate` (`-ac`, default on), `followRedirects` (`-r`), and `timeoutSeconds` (`-timeout`). Results are match rows; only the first 50 rows appear in the rendered text card.

#### Token effect

The tool adds one fuzz description and JSON schema to the model tool context; the complete JSON result is byte-bounded by `maxOutputBytes` (default 256 KiB).

#### KV Cache effect

The tool schema is part of the model tool prefix and remains cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Requires a local `ffuf` installation recent enough to support `-json` stdout output; the tool reports a clear error when the executable is missing.
- Wordlist paths point at execution-host files; path validation covers injection only, not existence or size.
- Recursion and multi-position mode (`-recursion`, multiple keywords) are not exposed; complex multi-position runs stay out of scope.
- Fuzz matches are evidence for attack-surface mapping, not proof of exploitability or an authorization grant.

<a id="dev-note"></a>
### Dev Note

Keep the tool name `ffuf_fuzz`, the `url`/`wordlist` parameter names, and the `networkTools` wiring synchronized with `assessment-scope-tool-policy` and the security-research bundle patch.
