---
description: "Model-facing Coordination tools for starting, inspecting, waiting on, cancelling, and messaging task graphs."
kind: "package-reference"
---

# dsh-tool-coordination

English | [中文](README.zh.md)

## Summary

Expose task-graph lifecycle operations to the model while keeping scheduling and execution replaceable.

## Use this package

This model-facing Consumer exposes task graphs through `ctx.tools` while leaving scheduling and execution in independently replaceable plugins. It registers six tools:

| Tool | Behavior |
|---|---|
| `coordination_start` | Validate and start a background DAG. |
| `coordination_add_task` | Add one task to a live owned run. |
| `coordination_status` | Read an owned run and its tasks, or one owned task. |
| `coordination_wait` | Wait until a target is terminal or a bounded timeout expires. |
| `coordination_cancel` | Cancel a run, or a task parent-subtree plus tasks transitively blocked by cancelled dependencies. |
| `coordination_send_message` | Commit a task-addressed message for installed listeners. |

Tasks carry a standalone `prompt`, optional stable `task_id`, dependency ids, an optional cancellation parent, and an optional executor kind. The Consumer passes `{ prompt, parentAgentId }` as the provider-specific task input. The companion [`dsh-coordination-subagent-executor`](../coordination-subagent-executor/README.md) accepts that input; another configured executor kind must accept the same fields.

## Table of Contents

- [Ownership and lifecycle](#ownership-and-lifecycle)
- [Config](#config)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="ownership-and-lifecycle"></a>
## Ownership and lifecycle

Every tool call requires the exact live calling Agent. Runs and tasks are visible only to the Session that started them, and task lookup uses the Consumer's ownership index before reading the process-global coordination service. An Agent disposal cancels its non-terminal runs and removes their tool access. Plugin disposal does the same, so HMR does not leave uncollectable work. A provider `run/evicted` event removes the corresponding ownership and task-index entries immediately.

`coordination_wait` subscribes to coordination events and rechecks state after subscription, so settlement cannot be missed between the initial read and listener installation. A timeout returns current state with `timedOut: true`; caller cancellation rejects the wait without cancelling the run.

`coordination_send_message` commits the message and identifies the caller as `sender`. The Service Definition notifies message listeners, but the commit does not claim that a remote or one-shot executor can accept live steering. A delivery adapter owns that behavior.

Task input is never returned to the model. Lossless JSON task output is returned; another executor's non-JSON output is omitted with `outputOmitted: true` rather than failing status inspection.

`CoordinationError` extends the harness machine-routable error base. Provider failures therefore preserve `{ name: 'CoordinationError', code }` in the tool result's `error.info`, including `EXECUTOR_UNAVAILABLE`, graph validation failures, ownership-visible unknown ids, and `RESOURCE_LIMIT`.

<a id="config"></a>
## Config

| Key | Meaning |
|---|---|
| `defaultExecutor` | Executor kind used when a task omits `executor` (default `subagent`). |
| `waitTimeoutMs` | Default `coordination_wait` duration (default `30000`). |
| `maxWaitTimeoutMs` | Hard cap on a model-selected wait (default `600000`). |

<a id="model-experience"></a>
## Model Experience

### Tool schemas and results

#### What the model sees

The model sees the six generated schemas in the [tool catalog](../../../docs/tool-catalog.md#tool-package-map) and one JSON text result per call. Start returns the generated run id and every installed task id. Status, wait, and cancel return detached task/run projections; wait additionally returns `timedOut`.

#### Token effect

Fixed schema cost for the six tools plus data-dependent JSON results. Run status scales with task count; task status is constant-size except for executor output.

#### KV Cache effect

Tool schemas remain prefix-stable while configuration and tool scoping are unchanged. Each result is an append-only conversation suffix.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The Consumer owns only runs started through its own tools. Host-started runs and runs created by another Consumer are intentionally inaccessible.
- Ownership and run/task indexes are process-local. Durable coordination requires a provider with persisted ownership and authenticated Host operations.
- Approval gates remain on `ctx.coordination` but are not exposed to the model; human or policy adapters own approval decisions.
- The tools do not create Git branches or worktrees. Isolation remains an optional executor or execution-host policy.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published because the Consumer's ownership indexes are private enforcement state exercised through tool operations; it publishes no independent event stream or durable projection to cross-check.

</details>
