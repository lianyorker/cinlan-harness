---
description: "Durable SQLite-backed Coordination provider with a write-ahead journal, crash recovery, and the same bounded task-graph semantics as the in-memory provider."
kind: "package-reference"
---

# coordination-sqlite

English | [中文](README.zh.md)

## Summary

Run task graphs across process restarts with registered executors, journaling every transition to a SQLite-backed key-value unit before it becomes observable.

## Use this package

This provider mirrors the in-memory coordination provider's admission, retention, cancellation, and disposal semantics, and adds a durability layer: every transition is validated against the explicit state-machine tables, committed to the journal, applied to memory, and only then emitted or resolved. A run that was mid-flight when the process died is settled as `failed` with `execution interrupted by process restart` during the next startup's recovery; tasks that were admitted but not yet dispatched resume from their journaled state and dispatch when their executor kind registers and the next pump runs. The recovery pump leaves ready tasks whose executor has not registered yet dispatchable instead of failing them, so the effect-based registration window after startup cannot destroy recoverable work.

Task input and output gates differ from the in-memory provider by the journal's storage medium: values must additionally survive a JSON round-trip (a non-finite number is rejected where JSON would silently null it), and an oversized successful outcome degrades to a bounded `failed` settlement instead of being retained.

Journal history is append-only: eviction removes runs from memory but never deletes journal records, so a fresh process can audit the full transition history. Malformed or tampered journal records fail startup loudly with `INVALID_TRANSITION` instead of being skipped. Journal writes are serialized per service; a failed write poisons every later operation rather than allowing memory and journal to diverge. Listeners and pending approvals are process-local: recovery does not replay the journal into listener callbacks, and a pending gate from the crashed process is unknown to the new one.

## Table of Contents

- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="config"></a>
## Config

| Key | Meaning |
|---|---|
| `backend` | Storage backend registry name providing the journal unit (default `sqlite`). |
| `unit` | Key-value unit name holding the journal (default `coordination`). |
| `maxConcurrency` | Maximum active executor calls across the process (default `4`). |
| `maxActiveRuns` | Maximum non-terminal runs retained at once (default `16`). |
| `maxTasksPerRun` | Maximum tasks installed in one run (default `128`). |
| `maxRetainedRuns` | Maximum terminal runs retained for later reads (default `32`). |
| `maxRetainedBytes` | Maximum V8-serialized bytes retained across task declarations and outcomes (default `16777216`). |

The service declares `storage` as its cordis injection: load the storage hub and a backend provider (for example `@deepseek-ai/dsh-storage-sqlite`) before this plugin, or the fiber never activates.

<a id="model-experience"></a>
## Model Experience

### No direct model context

#### What the model sees

This provider contributes no model-facing tool or prompt. Executor Consumers registered through `ctx.coordination` decide how task output reaches a Session or model.

#### Token effect

Zero-direct token effect; an Executor Consumer owns any bounded output that enters a model request.

#### KV Cache effect

None directly; an Executor Consumer owns any request-suffix change caused by task output.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

Semantic enforcement status, following the contract's `defined-not-enforced` convention:

| Semantic | Status |
|---|---|
| WAL ordering (journal commit before emit/resolve) | enforced — pinned by the journal-discipline test |
| Crash recovery (interrupted fail, no re-dispatch, resumable ready) | enforced — pinned by the recovery suite |
| Explicit transition tables | enforced — every mutation passes `assertTaskTransition`/`assertRunTransition` |
| Journal compaction | defined-not-implemented — the journal grows unboundedly; compaction by eviction watermark is a follow-up |
| Cross-process mutual exclusion | not-defined — two processes on one unit have no coordination guarantee |

- Single-process durability only: there is no cross-process lease, so two processes opening the same unit concurrently have no coordination guarantee.
- Journal growth is unbounded; compaction is deferred until a consumer needs it.
- SQLite is a Node experimental built-in (`node:sqlite`); the underlying backend owns that constraint.
- An executor that ignores `AbortSignal` can delay terminal cancellation and provider disposal.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The WAL ordering contract (validate → journal commit → memory mutation → emit/resolve) is the invariant the journal-discipline test pins: for one successful task the journal must hold exactly the ten records that the emitted event timeline shows, each strictly before its observation. `cancel` and `decideApproval` keep synchronous signatures and enqueue internally; `start`/`addTask` are genuinely async because their return values are consumed synchronously by callers.

</details>
