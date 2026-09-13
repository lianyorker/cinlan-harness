---
description: "In-memory Coordination provider for bounded task scheduling, retention, cancellation, and executor lifecycle."
kind: "package-reference"
---

# dsh-coordination-local

English | [中文](README.zh.md)

## Summary

Run in-memory task graphs with registered executors under configured concurrency and retention limits.

## Use this package

This provider keeps task graphs in memory and runs registered executors under configured concurrency, active-run, per-run task, terminal-run retention, and serialized retained-byte limits. It validates dependency and parent links, including both cycle classes, before publication. A failed or cancelled dependency cancels every transitively blocked task, including graphs declared in reverse dependency order and tasks added to a live run.

Executors return an explicit `TaskOutcome`; ordinary output is carried only in a successful outcome's `output` field, so data objects cannot be mistaken for lifecycle control. Task input and successful output must be structured-cloneable. The provider detaches them at admission, settlement, and every snapshot read so caller or executor mutation cannot change retained task state.

Caller-provided task ids remain reserved while their task is retained. Starting another run or adding a task with an id already owned by a retained run fails before the provider changes state or emits an event.

Terminal runs are retained in completion order. The provider evicts the oldest terminal run when the retained-run cap is exceeded or when an older terminal run must be released to admit task declarations or outcomes under the retained-byte cap. Eviction removes the run and its tasks, releases their ids, and emits `run/evicted`; later reads fail with `UNKNOWN_RUN` or `UNKNOWN_TASK`. Active-run, task-count, and declaration-byte rejections use `RESOURCE_LIMIT`. If a successful executor outcome cannot fit after eligible eviction, the task fails with a bounded resource diagnostic; oversized failure and cancellation diagnostics retain their lifecycle status with a bounded replacement message.

Cancellation aborts running executors with the caller's reason and does not settle the run until those executor calls return. Provider disposal first stops listener dispatch, rejects pending approvals, aborts non-terminal tasks, waits for every running executor to settle, and then clears in-memory state. Throwing or rejecting message, approval, and audit listeners are logged and isolated from later listeners and lifecycle commits.

## Table of Contents

- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="config"></a>
## Config

| Key | Meaning |
|---|---|
| `maxConcurrency` | Maximum active executor calls across the process (default `4`). |
| `maxActiveRuns` | Maximum non-terminal runs retained at once (default `16`). |
| `maxTasksPerRun` | Maximum tasks installed in one run (default `128`). |
| `maxRetainedRuns` | Maximum terminal runs retained for later reads (default `32`). |
| `maxRetainedBytes` | Maximum V8-serialized bytes retained across task declarations and outcomes (default `16777216`). |

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

- State is lost when the process exits.
- Serialized-byte accounting excludes JavaScript object overhead and transient executor allocations.
- The provider has no cross-process lease, Git isolation, or UI.
- An executor that ignores `AbortSignal` can delay terminal cancellation and provider disposal.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published because graph projections, retention accounting, and emitted lifecycle snapshots all derive from the same private scheduler state; the package has no second observation that can diverge independently.

</details>
