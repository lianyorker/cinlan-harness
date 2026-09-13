---
description: "Security skill catalog provider with bundled research guidance and references."
kind: "package-reference"
---
# @deepseek-ai/dsh-security-skills

English | [中文](README.zh.md)

## Summary
This provider registers the bundled security research skills and their supporting reference files with the Harness skill registry. It covers API, mobile, binary, firmware, malware, supply-chain, and LLM security workflows without embedding those documents into every prompt. The skill consumer loads a selected entry when the model requests it.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount the provider with the skill registry and load the security-research profile or a standalone security bundle. Keep the bundled files immutable and invoke a skill through the normal skill consumer rather than importing assets directly.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the skill consumer that owns model-visible skill loading.

#### KV Cache effect

No direct effect; only a selected skill contributes text to a model request.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The catalog is shipped with the package and is not edited through the Web UI.
- Skill content is guidance; assessment authorization remains owned by the assessment-scope service.

No runtime invariant companion is published because the registry owns skill registration uniqueness and lifecycle, while this provider only contributes immutable entries.

<a id="dev-note"></a>
### Dev Note

The package includes a large asset tree; keep asset paths relative to the package and preserve skill invocation metadata.
