---
description: "Worktree Task service contract for isolated checkout lifecycle management."
kind: "package-reference"
---
# @deepseek-ai/dsh-worktree-task

English | [中文](README.zh.md)

## Summary
This package defines the Worktree Task service used to create and manage isolated repository checkouts. Tasks have opaque ids, explicit active, hibernated, or archived lifecycle states, bounded operations, and provider-owned records. Remote controllers, Settings pages, and execution consumers use this contract without importing Git implementation details.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount a provider such as dsh-worktree-task-git as ctx.worktreeTask. Pass branded task ids across service and Remote calls, and use lifecycle methods rather than manipulating checkout paths directly.

Revisioned settings apply to future tasks; each task retains its captured starting point and programs. Read-only review returns bounded tracked changes, untracked filenames, and captured programs without activating a checkout. Archive and delete may return a cleanup receipt; a settled failure permits an explicit retry, while an unsettled claim blocks it. Successful cleanup is not repeated. Safe deletion retains an unmerged branch and archived record; receipts survive task deletion. Hibernation does not run cleanup.

The [Git provider](../worktree-task-git/README.md) owns command execution, checkout containment, settlement, and durability.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Worktree Task Remote and settings consumers.

#### KV Cache effect

No direct effect; Worktree Task state reaches a model only through a consumer that chooses to include it.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The service contract does not prescribe a storage backend or a Git executable.
- Providers decide checkout quotas, persistence, and subprocess limits.

No runtime invariant companion is published because this package defines the service contract and owns no provider state.

<a id="dev-note"></a>
### Dev Note

`WorktreeTaskId` is an opaque branded identifier. Address lifecycle calls with provider-issued ids; do not derive a checkout path from an id. Current acceptance evidence and remaining verification are tracked in the [acceptance status](../../../.agents/plans/settings-native-acceptance-status.md).
