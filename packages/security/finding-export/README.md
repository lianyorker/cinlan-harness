---
description: "Deterministic JSON, Markdown, and SARIF exporters for Security Research Findings."
kind: "package-library"
---

# @deepseek-ai/dsh-finding-export

English | [中文](README.zh.md)

## Summary

This library converts typed Finding snapshots into deterministic JSON, Markdown, or SARIF 2.1.0 bytes without reading evidence contents or contacting external services.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Call `exportFindingsJson`, `exportFindingsMarkdown`, or `exportFindingsSarif` with complete Finding snapshots. Findings are sorted by severity, state, and id; empty reports use the Unix epoch so equal inputs produce equal bytes. A Consumer owns authorization, attachment persistence, and download presentation.

<a id="model-experience"></a>
## Model Experience

### Export output

#### What the model sees

No model tool or prompt is registered by this library. A Consumer may expose the bytes from `exportFindingsJson` or another exporter after its own authorization check.

#### Token effect

The exporter adds no tokens; any report summary shown to a model is owned by the calling Consumer.

#### KV Cache effect

Exporting a report does not change the model cache prefix.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Exporters include Finding metadata and Artifact references, not Artifact bytes or credentials.
- The caller must enforce assessment scope before exporting and must choose the appropriate report retention policy.

No runtime invariant companion is published because these pure exporters retain no state; the caller owns report authorization and persistence.

<a id="dev-note"></a>
### Dev Note

Keep stable ordering and timestamp rules unchanged when extending the export schema; update exporter tests and report consumers together.
