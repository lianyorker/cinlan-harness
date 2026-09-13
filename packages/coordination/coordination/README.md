---
description: "Coordination service definitions for task graphs, lifecycle, diagnostics, messages, approvals, and executor contracts."
kind: "package-reference"
---

# dsh-coordination

English | [中文](README.zh.md)

## Summary

Coordinate task identity, lifecycle, diagnostics, approvals, messages, and audit events through a provider-neutral service.

## Use this package

The Service Definition owns branded run and task identifiers, DAG validation, task lifecycle states, typed diagnostics, task messages, approval hooks, and audit events. A run result settles only after every task is terminal and every admitted executor call has settled. Providers choose scheduling and execution policy.

Executors return an explicit `TaskOutcome`; successful data belongs in its `output` field and cannot be confused with lifecycle control. Public run/task snapshots, messages, approval values, and event payloads use readonly fields. Providers give each caller and Listener an independently detached value so mutation cannot alter retained state or another observer's input.

`TaskId` is unique while its task remains retained because task lookup, cancellation, messages, and approvals address a task without a `RunId`. Reusing a retained id fails with `DUPLICATE_TASK` before publication. A Provider may evict terminal runs under its documented retention policy; `run/evicted` reports that removal, later reads fail with `UNKNOWN_RUN` or `UNKNOWN_TASK`, and released ids may be reused.

The service does not create Git branches or worktrees, own an Agent loop, persist transcripts, or expose a renderer. `coordination-local` is the process-local provider.

Cancellation reasons reach running executors as `AbortSignal.reason`. Cancelling a task covers its parent subtree and every task transitively blocked because a cancelled dependency cannot succeed. Message, approval-request, and audit listeners observe committed state; a thrown or rejected listener cannot alter lifecycle state or prevent later listeners from running. An approval request settles only through `decideApproval`, task cancellation, or provider disposal.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="model-experience"></a>
## Model Experience

### No direct model context

#### What the model sees

This package contributes no model-facing tool or prompt text. [`dsh-tool-coordination`](../tool-coordination/README.md) exposes selected operations through `ctx.tools` without moving ownership into the Service Definition.

#### Token effect

Zero-direct token effect; a Consumer owns any task projection that enters a model request.

#### KV Cache effect

None directly; a Consumer owns any request-suffix change caused by task observations.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The Service Definition has no durable provider, remote lease, budget accounting, or built-in approval UI.
- Executors are provider registrations and must supply their own Agent, Session, process, and sandbox ownership.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published because this Service Definition owns types and registration contracts but no mutable implementation state or independent observation to compare.

</details>
