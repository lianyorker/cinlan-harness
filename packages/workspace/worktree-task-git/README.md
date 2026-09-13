---
description: "Git-backed Worktree Task provider with bounded checkout lifecycle operations."
kind: "package-reference"
---
# @deepseek-ai/dsh-worktree-task-git

English | [中文](README.zh.md)

## Summary
This provider implements Worktree Task lifecycle operations with Git worktrees and the Harness storage domain. It serializes mutations, bounds active checkouts, preserves task records across provider restarts, and cleans up only provider-owned paths. Session bindings let Remote and task consumers address a task without receiving arbitrary filesystem authority.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount the provider as ctx.worktreeTask with a repository root and a writable DSH home. Configure the active checkout limit and subprocess bounds for the deployment, then use the service or generated Remote controller for lifecycle operations.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Worktree Task Remote and settings consumers.

#### KV Cache effect

No direct effect; Git checkout state reaches a model only through a consumer that chooses to include it.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The provider requires a Git executable and a writable task storage root.
- Provider records and checkout cleanup are local to the configured Host; they are not a distributed lease service.

No runtime invariant companion is published because the provider's authoritative task state is observed through its service methods rather than a separate invariant stream.

<a id="dev-note"></a>
### Dev Note

The provider owns subprocess cancellation and cleanup; callers must use task ids and lifecycle methods rather than reconstructing paths.
