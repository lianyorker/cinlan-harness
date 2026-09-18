---
description: "Execution-host identity contract for provenance and assessment authorization."
kind: "package-reference"
---
# @deepseek-ai/dsh-execution-host

English | [中文](README.zh.md)

## Summary
This package defines the execution-host identity used by artifact provenance and assessment authorization. A provider returns one stable host id with hostname, process, platform, and creation metadata. Consumers use the identity to associate evidence with the process that produced it rather than trusting a browser-supplied value.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount one ExecutionHostService provider in compositions that publish evidence or authorize assessment actions. Read ctx.executionHost.current() at the operation that records provenance or evaluates host authorization.

<a id="model-experience"></a>
## Model Experience

None, as the execution-host identity service registers no prompt, tool, or Session event.

#### KV Cache effect

None; host identity metadata does not alter model requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The service describes the current process and does not attest a remote machine.
- Host identity lifetime and persistence are provider decisions.

No runtime invariant companion is published because this package defines an abstract service without mutable provider state.

<a id="dev-note"></a>
### Dev Note

ExecutionHostId is opaque and must remain branded at service and wire boundaries. The `./types` entry exposes process-provenance DTOs to Client programs without importing the Host service; the root entry also exports those types.
