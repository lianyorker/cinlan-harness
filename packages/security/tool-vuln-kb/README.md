---
description: "Model-facing vulnerability knowledge-base query tools."
kind: "package-reference"
---
# @deepseek-ai/dsh-tool-vuln-kb

English | [中文](README.zh.md)

## Summary
This plugin exposes bounded vulnerability lookup tools backed by the active knowledge-base service. The model can query by CVE or package coordinates and read one CVE details, while provider failures and result limits remain typed. It does not authorize assessment actions or claim that a matching vulnerability is exploitable.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount the plugin with dsh-vuln-kb-service, a provider such as dsh-vuln-kb-nvd, and the core tool registry. The generated tool schemas are the source of truth for arguments and result fields.

<a id="model-experience"></a>
## Model Experience

### Vulnerability lookup tool schemas

#### What the model sees

The model receives the query and read schemas documented in the [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-vuln-kb).

#### Token effect

The plugin adds vulnerability query and read descriptions and JSON schemas to the model tool context.

#### KV Cache effect

The tool schemas are part of the model tool prefix and remain cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Results depend on the active provider and upstream knowledge-base freshness.
- A lookup result is evidence for triage, not an authorization grant or proof of exploitability.

No runtime invariant companion is published because the tool plugin registers schemas and delegates state to the knowledge-base service.

<a id="dev-note"></a>
### Dev Note

Keep tool names and schema bounds synchronized with the generated tool catalog.
