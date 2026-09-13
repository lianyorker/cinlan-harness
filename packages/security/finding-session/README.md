---
description: "Session-backed provider for durable typed security findings and evidence references."
kind: "package-reference"
---
# @deepseek-ai/dsh-finding-session

English | [中文](README.zh.md)

## Summary
This provider stores typed security findings in the active Session service and publishes immutable snapshots for query and transition operations. It deduplicates canonical identities, enforces revision checks, validates evidence prerequisites, and authorizes referenced artifacts before state changes. Use it with the finding service definition and finding tools.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount it with Sessions, Agents, the finding service, and an ArtifactService provider. The provider derives the initiating Agent and Session from each call, so findings remain scoped to the caller rather than to a global process map.

<a id="model-experience"></a>
## Model Experience

Indirectly, through finding tools that own the model-visible schemas and result rendering.

#### KV Cache effect

No direct effect; finding snapshots enter model context only when a finding consumer queries them.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Finding state is retained according to the mounted Session persistence policy.
- Artifact bytes remain owned by the configured ArtifactService provider.

No runtime invariant companion is published because the Session finding stream is the authoritative observation used by this provider.

<a id="dev-note"></a>
### Dev Note

Transitions require the exact finding id and revision; reproduction and remediation states require typed evidence.
