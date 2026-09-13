---
description: "Typed artifact metadata and authorization contract for evidence and reports."
kind: "package-reference"
---
# @deepseek-ai/dsh-artifact

English | [中文](README.zh.md)

## Summary
This package defines the artifact references used for security evidence, reports, and recordings. Producers publish bytes with immutable media, provenance, retention, and redaction metadata, while callers authorize scoped reads and writes with branded identifiers. Providers choose storage and retention behavior without changing the metadata contract.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount an ArtifactService provider when findings or other consumers publish evidence. Use branded provenance identifiers and pass authorization fields that match the artifact scope. The service definition is provider-neutral and does not store bytes itself.

<a id="model-experience"></a>
## Model Experience

None, as the artifact service defines metadata and registers no prompt, tool, or Session event.

#### KV Cache effect

None; artifact metadata does not alter model requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Storage durability, garbage collection, and byte access remain provider responsibilities.
- Authorization covers declared session, task, engagement, and scope references; host identity is provenance, not a caller grant.

No runtime invariant companion is published because this package declares a service contract and owns no mutable provider state.

<a id="dev-note"></a>
### Dev Note

The public types live in src/types.ts; providers must preserve immutable ArtifactRef metadata and authorization semantics.
