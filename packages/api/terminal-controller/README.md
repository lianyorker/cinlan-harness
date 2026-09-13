---
description: "Host Remote controller for session-scoped terminal lifecycle operations."
kind: "package-reference"
---
# @deepseek-ai/dsh-api-terminal-controller

English | [中文](README.zh.md)

## Summary
This package exposes session-scoped terminal sessions through the generated Host and browser Remote faces. A Web client can list, start, send input to, read output from, refresh, and close terminals without receiving a process handle. The controller keeps terminal ownership in the Host service and returns typed errors when the provider is unavailable.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount the controller beside the Typert Gateway and a ctx.terminals provider. Mount dsh-api-remotes to project the generated remote face to the browser. The Remote accepts opaque terminal session ids and forwards cancellation to provider operations.

<a id="model-experience"></a>
## Model Experience

None, as the terminal Remote controller registers no prompt, tool, or Session event.

#### KV Cache effect

None; terminal administration does not alter model requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The controller exposes existing terminal sessions and does not provide a durable terminal transcript store.
- Output retention and process limits remain owned by the terminal provider.

No runtime invariant companion is published because the controller is a stateless Remote projection over the terminal service.

<a id="dev-note"></a>
### Dev Note

Typert generates the Host and Remote declarations; edit src/index.ts and src/types.ts rather than generated files.
