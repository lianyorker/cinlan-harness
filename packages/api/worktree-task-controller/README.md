---
description: "Host Remote controller for local Worktree Task lifecycle operations."
kind: "package-reference"
---
# @deepseek-ai/dsh-api-worktree-task-controller

English | [中文](README.zh.md)

## Summary
This package exposes Worktree Task lifecycle operations through a typed Host Remote namespace. Local Web clients can create, list, activate, hibernate, archive, and delete tasks using opaque task ids and structured requests. The controller keeps Git and filesystem policy in ctx.worktreeTask and reports provider errors without accepting browser paths or commands.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount the controller with the Typert Gateway and a ctx.worktreeTask provider. Mount dsh-api-remotes for the browser namespace. The controller preserves cancellation and maps provider failures to stable Remote error codes.

<a id="model-experience"></a>
## Model Experience

None, as the Worktree Task Remote controller registers no prompt, tool, or Session event.

#### KV Cache effect

None; task administration does not alter model requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Task creation and checkout limits remain provider configuration choices.
- The Remote does not stream Git subprocess output; callers receive operation results or typed errors.

No runtime invariant companion is published because the controller is a stateless Remote projection over the Worktree Task service.

<a id="dev-note"></a>
### Dev Note

Typert generates the Host and Remote declarations; edit src/index.ts and src/types.ts rather than generated files.
