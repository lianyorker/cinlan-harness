---
description: "Host Remote controller for local Worktree Task lifecycle operations."
kind: "package-reference"
---
# @deepseek-ai/dsh-api-worktree-task-controller

English | [中文](README.zh.md)

## Summary
Create and manage Worktree Tasks through the typed `worktreeTasks` Remote namespace. Read and save defaults, review task changes, and request activation, hibernation, archiving, or safe deletion. Creation accepts a source repository and defaults accept structured program/argument configuration; lifecycle calls address provider-issued task ids. The provider owns filesystem policy and execution.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount the controller with the Typert Gateway and a `ctx.worktreeTask` provider, then mount `dsh-api-remotes` for the browser namespace. The generated Remote exposes `settings`, `updateSettings`, `review`, and lifecycle methods. Saving defaults requires the current revision; review is read-only and bounded; cleanup receipts distinguish unsettled execution, success, and failure. The controller forwards cancellation to the provider and maps provider failures to stable Remote error codes.

<a id="model-experience"></a>
## Model Experience

None, as the Worktree Task Remote controller registers no prompt, tool, or Session event.

#### KV Cache effect

None; task administration does not alter model requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The managed root and active-checkout quota belong to provider deployment configuration; Remote defaults cannot change them.
- The Remote does not stream Git subprocess output; callers receive operation results or typed errors.

No runtime invariant companion is published because the controller is a stateless Remote projection over the Worktree Task service.

<a id="dev-note"></a>
### Dev Note

Typert generates the Host and Remote declarations; edit `src/index.ts` and `src/types.ts` rather than generated files. Current acceptance evidence and remaining verification are tracked in the [acceptance status](../../../.agents/plans/settings-native-acceptance-status.md).
