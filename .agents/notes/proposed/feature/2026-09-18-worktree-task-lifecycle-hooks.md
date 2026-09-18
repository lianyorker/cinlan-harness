# Agent Note: Captured Worktree Task programs and cleanup receipts

Status: proposed

English | [中文](2026-09-18-worktree-task-lifecycle-hooks.zh.md)

## Problem

Saved task programs need an execution owner, a clear trigger, and a recovery rule before Settings can expose them. Arbitrary cleanup can affect systems outside the checkout. Repeating it after a lost response or reclaiming its directory before descendants exit can compound those effects.

## Proposal

The task provider captures validated defaults at creation: starting ref, contained relative directory, and resolved executable/argument arrays. The authenticated defaults operation accepts this configuration with a revision fence. Individual lifecycle requests still accept only task ids; they cannot substitute a command or checkout path. Saving runs nothing and does not rewrite existing tasks.

Setup runs before publishing a task. Cleanup runs only for explicit archive or delete, never hibernation, capacity eviction, or startup recovery. The provider persists a running claim before execution, waits for the whole process tree, and persists success before checkpointing or reclamation. An archived task can be safely deleted without repeating cleanup. A retained unmerged branch remains archived.

A known settled failure preserves the checkout and permits explicit retry. A crash, unknown exit, or failed success write leaves an unsettled claim and prevents rerunning. Failed and unsettled cleanup checkouts are excluded from automatic reclamation. Receipts remain after task deletion. Existing archived tasks do not gain retroactive execution. There is no automatic recovery from an unsettled claim.

A separate `cleanup_receipts` table uses the existing version-one KV domain; no released Session data changes. Compatibility requires opening a real earlier tasks-only domain through both JSON and SQLite providers, then persisting and reopening the added table. Read-only task review returns bounded changes, captured programs, and receipt state without activating a checkout.

This partially supersedes the prohibition on browser-configured programs in the [Web composition note](../../implemented/feature/2026-09-10-worktree-sidebar-security-integration.md). That note remains active for default composition, lifecycle id ownership, sidebar, and security decisions. The [settings ownership note](../../implemented/architecture/2026-09-17-native-settings-runtime-consumers.md) remains the owner of feature-local defaults and accepted writes. No complete implemented note is superseded or eligible for archival by this change.

## Alternatives considered

**Run cleanup during every reclamation.** Capacity and restart maintenance are not explicit requests to perform arbitrary external effects. Cleanup belongs to task termination chosen by the user.

**Retry any unacknowledged cleanup.** A missing success response cannot establish that no external effect occurred. Persisted claims prefer manual inspection over an automatic duplicate.

**Treat program text as a shell command.** Separate executable and argv preserve exact arguments and keep shell interpretation an explicit program choice. Lifecycle calls cannot replace the captured program.

**Claim exactly-once execution.** A local receipt cannot atomically commit an arbitrary external side effect. Known failure retries may repeat effects; unknown outcomes block instead of claiming success or safety.

## Acceptance criteria

- Defaults save and reload through the real Web composition; stale revisions reject without changing future defaults or existing launch facts.
- Setup receives exact argv in the owned checkout, publishes only on success, and does not repeat after activation; rollback waits for process-tree exit. Working directories must exist inside the checkout at program execution and publication; overlapping reservations reject before eviction.
- Cancellation after real Git add finishes reconciles and rolls back only owned allocations. Unknown settlement retains the allocation with concrete recovery diagnostics; unrelated replacement directories survive rollback.
- Archive/delete cleanup is deduplicated after durable success, retains failed checkouts, and refuses reruns after unknown settlement or a failed success write.
- JSON and SQLite tasks-only version-one data opens without loss, and receipts survive deletion and restart.
- Real Web review displays tracked differences and untracked names without mutation; hibernation skips cleanup and archive exposes its receipt.
- Generated Remote declarations, Host/Client type checks, focused behavior tests, and assembled Web/Electron acceptance pass. Current execution status belongs to the [acceptance record](../../../plans/settings-native-acceptance-status.md).

## Risks

Programs run with the Host subprocess provider's authority and can change external systems. Explicit retry after a settled failure can repeat those effects. Unsettled receipts require operator recovery outside this UI and consume retained checkout capacity. Filesystem checks are point-in-time observations; external replacement can race them, and a hard Host crash before publication has no durable create journal. Current validation evidence and remaining acceptance work belong to the [acceptance record](../../../plans/settings-native-acceptance-status.md); this note remains proposed until all acceptance criteria are met.
