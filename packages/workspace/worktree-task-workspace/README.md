---
description: "Bridges Worktree Task checkouts into the Workspace registry with durable parent links and one-time session backfill."
kind: "package-reference"
---
# @cinlan/worktree-task-workspace

English | [中文](README.zh.md)

## Summary
This Host bridge registers each materialized Worktree Task checkout as a Workspace, titles it after the task, links it to the Workspace registered at the task's source path, and attaches the task's sessions through the registry's own validated `attachSession`. Parent and task relationships live in this package's own storage domain; the Workspace registry's records and the session persistence schema stay unchanged.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount the service as `ctx.worktreeTaskWorkspaces` with `storageDomain`, `workspaceRegistry`, and `sessionPersistence` providers. The `worktreeTask` provider is read optionally at startup to scan already-active tasks. The bridge consumes committed `worktree-task/changed` transitions on one serial queue; a failed step is logged and never fails the task operation that emitted it.

For every `created` or `activated` transition the bridge runs one `ensure` step: it skips a task whose checkout directory is absent (the next activation retries), otherwise it creates the Workspace at the checkout path, titles it after the task only for a fresh registration, resolves the parent Workspace (the task's recorded id when its path still matches the source, else the Workspace registered at the source path, else none), and stores the link in the `worktree_task_workspaces` domain's `links` table. A `bound` transition first runs `ensure` and then attaches the session when its header already exists; an attach rejection is logged only. `unbound`, `hibernated`, `archived`, and `deleted` transitions keep the registration and its link on purpose, so accounted sessions keep their group while the directory is absent; deleting the registration is left to the user through the registry's own delete operation.

The first `ensure` for a checkout also performs a one-time membership backfill: the task's bound sessions plus stored sessions whose canonical cwd equals the checkout path, skipping sessions another Workspace already accounts. Attach failures during backfill are logged and never stop the remaining candidates.

Read-only access uses `links()`, which projects stored links whose checkout Workspace is still registered (a deleted parent registration is omitted), and `settled()`, which resolves once the current queue tail has been handled. Every durable link change emits `worktree-task-workspaces/changed` (`@mode emit`).

<a id="model-experience"></a>
## Model Experience

No direct effect; Workspace titles and grouping reach a model only through a consumer that chooses to include them.

#### KV Cache effect

No direct effect; the link set is host-side bookkeeping and never enters a model request by itself.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Archived and deleted tasks keep no checkout directory, so their sessions cannot be backfilled; sessions created before the bridge was installed stay unaccounted unless the task is reactivated.
- A `bound` transition whose session header does not exist yet (agent-team binds before creating the session) is logged and not attached; the session keeps its parent's cwd and stays a subagent until a later transition or backfill covers it.
- Task checkout Workspaces appear in the Workspace picker and search like any other Workspace; there is no first-class "task" kind in the registry.
- Creating a session through a task group row accounts it in the Workspace but not in `task.sessionIds`, so it does not block hibernation.
- The bridge never deletes a Workspace registration; users remove one through the registry's delete operation and the link then disappears from `links()` while the stored record remains.

No runtime invariant companion is published because the authoritative link state is observed through the service's `links()` method rather than a separate invariant stream.

<a id="dev-note"></a>
### Dev Note

The bridge owns only its `worktree_task_workspaces` domain; it never writes registry records outside `create`/`setTitle`/`attachSession` and never mutates task records.
