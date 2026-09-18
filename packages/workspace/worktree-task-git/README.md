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
Mount the provider as `ctx.worktreeTask` with `storageDomain` and `subprocess` providers. Configure its managed checkout root (default `<DSH_HOME>/worktree-tasks/v1`), active-checkout limit, and subprocess bounds; each create request supplies its source repository path.

Create requires a clean source repository: staged, unstaged, and untracked changes all reject. It canonicalizes the repository and source paths and records the repository root, requested base ref, and resolved base head before creating the task.

[Git preferences](../../git/git-settings/README.md) apply only to new task branches. None creates `dsh/task/<uuid>`. Custom prepends its literal non-empty value, with a separating slash when needed. Git Username reads repository-local `github.user`, then `user.username`; it never reads `user.name`, global or included configuration, or a network identity. A missing or invalid username fails with instructions to set local configuration or change prefix mode.

Git validates prefixed branch names with `check-ref-format --branch` before capacity eviction or worktree mutation. Invalid Custom values fail without hibernating existing tasks. A missing Settings service or unregistered Git namespace explicitly resolves the shared defaults. Settings changes never rename recorded branches, including after reactivation or provider restart.

Create does not fetch or fast-forward the local base, even when the saved base-refresh preference is true. Provider checkpoint commits retain their own message, attribution, and disabled-signing policy, including `--no-gpg-sign`.

Revisioned defaults select a starting ref, a relative directory beneath the managed root, and optional setup/cleanup programs with separate argument arrays. Create resolves and captures those programs, then runs setup directly in the owned checkout before publishing the task. Saving defaults runs no program, and reactivation never repeats setup. Changes apply only to future tasks. Absolute, parent-traversing, linked, and overlapping reserved checkout destinations reject before capacity eviction. Creation, binding, activation, and program execution require the working directory to exist inside the checkout; ownership checks also validate its managed ancestors.

Explicit archive and delete run the captured cleanup before checkpointing and reclaiming the checkout; hibernation, capacity eviction, and startup recovery do not run it. An inactive task may be reactivated for this explicit cleanup. A durable running claim precedes execution, and a success receipt precedes reclamation. Archive followed by delete does not repeat cleanup. An unmerged branch remains archived after safe deletion is refused.

A settled cleanup failure retains the checkout and permits an explicit retry, which may repeat external side effects. A crash, unknown process exit, or failed success-receipt write leaves an unsettled claim and blocks reruns; the operator must inspect the checkout and external system before recovery. Failed and unsettled cleanup checkouts are excluded from automatic reclamation. Cleanup receipts remain in the provider's storage domain after task deletion; existing archived tasks do not acquire retroactive cleanup.

Git and lifecycle programs share the managed subprocess runner's per-stream `maxOutputBytes`, `commandTimeoutMs`, `graceMs`, cancellation, and waits for command and process-tree exit. Nonzero exit, output truncation, cancellation, and timeout reject, including timeout followed by exit zero. On a known-settled create failure, rollback reconciles the new worktree and branch, then removes only owned allocations; this includes cancellation after Git add finishes. Unknown settlement retains them and reports the allocated task id, branch, and paths for operator inspection. Rollback refuses unrelated occupancy, reports failure, and cannot undo external effects.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Worktree Task Remote and settings consumers.

#### KV Cache effect

No direct effect; Git checkout state reaches a model only through a consumer that chooses to include it.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The provider requires a Git executable and a writable task storage root.
- Provider records and checkout cleanup are local to the configured Host; they are not a distributed lease service. Path checks do not lock against concurrent external replacement. There is no durable create journal for a Host crash before task publication.
- Hooks execute with the Host subprocess provider's authority. Receipts cannot make external side effects exactly-once, and no automatic recovery clears an unsettled claim.
- Read-only review returns a bounded tracked patch, untracked names, captured programs, and any cleanup receipt. It does not integrate branches or activate a checkout.

No runtime invariant companion is published because the provider's authoritative task state is observed through its service methods rather than a separate invariant stream.

<a id="dev-note"></a>
### Dev Note

The provider owns subprocess cancellation and cleanup; callers must use task ids and lifecycle methods rather than reconstructing paths. Current acceptance evidence and remaining verification are tracked in the [acceptance status](../../../.agents/plans/settings-native-acceptance-status.md).
