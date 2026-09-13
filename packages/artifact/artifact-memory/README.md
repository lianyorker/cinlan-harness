---
description: "Process-local artifact provider for scoped security evidence and reports."
kind: "package-reference"
---
# @deepseek-ai/dsh-artifact-memory

English | [中文](README.zh.md)

## Summary
This provider stores published artifact bytes and references in process memory. It derives execution-host provenance from ctx.executionHost, calculates SHA-256 metadata, and enforces session, task, engagement, and scope authorization on reads and writes. It is suitable for local Web profiles and tests where restart loss is acceptable.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount dsh-execution-host-local before this provider and mount the dsh-artifact service contract. Consumers receive immutable references while the provider retains the corresponding bytes until process teardown.

<a id="model-experience"></a>
## Model Experience

None, as the in-memory artifact provider registers no prompt, tool, or Session event.

#### KV Cache effect

None; evidence storage does not alter model requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Restarting the Host removes all stored bytes and metadata.
- The provider has no quota or background garbage collector; deployment profiles must bound usage through their consumers.

No runtime invariant companion is published because the provider's mutable map is fully owned by its ArtifactService methods and has no separate observation stream.

<a id="dev-note"></a>
### Dev Note

The provider requires the executionHost service and must not accept a caller-supplied host id for provenance.
