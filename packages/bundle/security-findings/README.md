---
description: "Installable bundle for typed security findings, evidence, and finding tools."
kind: "package-bundle"
---

# @deepseek-ai/dsh-security-findings

English | [中文](README.zh.md)

## Summary
This bundle composes the finding service, Session-backed finding provider, artifact contract, and model-facing finding tools. It gives a profile a complete record, query, transition, and export path while preserving typed evidence prerequisites and scoped artifact authorization.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Load the bundle through a dsh profile or include its Loader entries in a controlled composition. Supply an ArtifactService and Session provider before using finding transitions or exports.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the finding tools inserted by this bundle.

#### KV Cache effect

The finding tool schemas may contribute stable model tool-prefix content; the bundle providers do not add prompt text.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The bundle does not authorize targets or execute scanners.
- Finding persistence and artifact retention depend on the mounted providers.

No runtime invariant companion is published because this bundle composes independent providers and consumers without owning a separate mutable projection.

<a id="dev-note"></a>
### Dev Note

Keep the Loader patch as an insert list and update tool-catalog output when finding schemas change.
