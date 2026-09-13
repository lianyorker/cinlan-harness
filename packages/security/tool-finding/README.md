---
description: "Model-facing tools for recording, querying, transitioning, and exporting security findings."
kind: "package-reference"
---
# @deepseek-ai/dsh-tool-finding

English | [中文](README.zh.md)

## Summary
This plugin registers finding_record, finding_query, finding_transition, and finding_export. The tools expose typed finding identity, scoped evidence, lifecycle prerequisites, and SARIF, Markdown, or JSON report export. They delegate persistence and artifact authorization to the active finding and ArtifactService providers.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount the plugin with dsh-finding, dsh-finding-session, dsh-artifact, dsh-artifact-local, and the core tool registry. Keep assessment-scope-session and its report-download action configured before allowing finding_export model calls; other Finding calls retain their own evidence prerequisites.

JSON and Markdown report timestamps come from the latest Finding update; empty reports use the Unix epoch. SARIF contains no wall-clock timestamp.

<a id="model-experience"></a>
## Model Experience

### Finding tool schemas

#### What the model sees

The model receives the four finding tool schemas documented in the [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-finding).

#### Token effect

The plugin adds finding operation descriptions and JSON schemas to the model tool context.

#### KV Cache effect

The tool schemas are part of the model tool prefix and remain cacheable until the loaded tool composition changes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- A tool call records or transitions a finding but does not independently prove exploitability.
- Export bytes are published through ArtifactService and are not embedded in the tool result. `finding_export` requires report-download for every Finding target when assessment-scope-session is mounted; a missing scope denies export.

No runtime invariant companion is published because this plugin registers tool schemas and delegates mutable state to finding and artifact services.

<a id="dev-note"></a>
### Dev Note

Reproduction and remediation transitions require typed evidence; keep the tool catalog synchronized with schema changes.
