---
description: "Model-facing nuclei template-based vulnerability scan tool for authorized assessments."
kind: "package-reference"
---
# @cinlan/tool-nuclei

English | [中文](README.zh.md)

## Summary
This package registers the `nuclei_scan` tool on `ctx.tools`. It shells out to a locally installed `nuclei` binary through `ctx.subprocess`, parses `-json` output into bounded finding rows (template, severity, matched URL), and always emits `-json -silent -no-color -ni`: no color, no interactsh out-of-band callbacks, and never `-dast` or payload-mutation flags. Authorization is enforced upstream by `assessment-scope-tool-policy`: each `target_id` must match a target declared in the active assessment-scope grant, and the tool name must be listed in that policy's `networkTools`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount with `@deepseek-ai/dsh-subprocess` (a provider such as `dsh-subprocess-local`), `@deepseek-ai/dsh-tools`, and `@deepseek-ai/dsh-assessment-scope-tool-policy` configured with `networkTools` including `nuclei_scan`. The `nuclei` binary and any referenced local template directories must be resolvable on the execution host; template updates stay in nuclei's own cache.

<a id="model-experience"></a>
## Model Experience

### nuclei_scan tool schema

#### What the model sees

The model receives the generated [`nuclei_scan` schema](../../../docs/tool-catalog.md#cinlantool-nuclei): `target_id` (required, whitespace/comma-separated URLs or bare hosts that must match grant targets, at most 100), optional `templates` (`-t`), `severities` (`-severity`, info..critical), `followRedirects`, and `timeoutSeconds` (`-timeout`). Results are finding rows; only the first 50 rows appear in the rendered text card.

#### Token effect

The tool adds one scan description and JSON schema to the model tool context; the complete JSON result is byte-bounded by `maxOutputBytes` (default 256 KiB).

#### KV Cache effect

The tool schema is part of the model tool prefix and remains cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Requires a local `nuclei` installation; the tool reports a clear error when the executable is missing.
- Template coverage depends on the local nuclei template cache; no update is triggered by this tool.
- Out-of-band (interactsh) findings are disabled by default; blind vulnerabilities needing OOB callbacks require an explicit egress decision and stay out of scope here.
- A template match is evidence for triage, not proof of exploitability or an authorization grant.

<a id="dev-note"></a>
### Dev Note

Keep the tool name `nuclei_scan`, the `target_id` parameter name, and the `networkTools` wiring synchronized with `assessment-scope-tool-policy` and the security-research bundle patch.
