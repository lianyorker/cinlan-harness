# Coordination

[English](coordination.md) | 中文

## 概述

本参考列出 `packages/coordination` 包族声明的 Cordis API。[Coordination Service Definition](../../packages/coordination/coordination/README.zh.md)负责 Run／Task 身份、依赖、消息、审批、执行器注册与取消。Provider 执行这些请求；调用方不能仅凭任务标识获得 Agent、Session 或进程权限。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcoordination--coordinationservice-abstract-seam"></a>

### `ctx.coordination` — `CoordinationService` (abstract seam)

Swappable task-coordination capability.

```ts cordis-catalog
/** Register an executor kind and return its disposer.
 * @param kind - executor registry key.
 * @param executor - callback invoked for admitted tasks.
 * @returns disposer that unregisters this callback.
 */
abstract registerExecutor(kind: string, executor: TaskExecutor): () => void

/** Validate and start a task DAG.
 * @param request - task declarations forming the graph.
 * @returns live run handle.
 */
abstract start(request: StartRunRequest): CoordinationRun

/** Read one run projection.
 * @param id - run identifier.
 * @returns detached run snapshot.
 */
abstract getRun(id: RunId): RunSnapshot

/** Read one task projection.
 * @param id - task identifier.
 * @returns detached task snapshot.
 */
abstract getTask(id: TaskId): TaskSnapshot

/** List tasks belonging to a run in graph declaration order.
 * @param runId - run identifier.
 * @returns detached task snapshots.
 */
abstract listTasks(runId: RunId): TaskSnapshot[]

/** Add a validated task to a live run; it starts as ready when it has no dependencies and pending otherwise.
 * @param runId - target run identifier.
 * @param spec - task declaration.
 * @returns the installed task identifier.
 */
abstract addTask(runId: RunId, spec: TaskSpec): TaskId

/**
 * Cancel a run or a task's parent subtree plus tasks transitively blocked by cancelled dependencies.
 * Running executor calls receive the reason through `AbortSignal.reason`.
 * @param target - run or task identifier.
 * @param reason - cancellation reason forwarded to executors.
 */
abstract cancel(target: RunId | TaskId, reason?: string): void

/** Deliver a task message and emit it to registered listeners.
 * @param taskId - recipient task identifier.
 * @param message - non-empty message text.
 * @param sender - optional sender label.
 * @returns committed message record.
 */
abstract sendMessage(taskId: TaskId, message: string, sender?: string): TaskMessage

/** Register a task-message observer.
 * @param listener - callback for committed messages.
 * @returns disposer that unregisters the callback.
 */
abstract onMessage(listener: TaskMessageListener): () => void

/** Request an approval gate; a registered answerer must resolve it. Listener failures are isolated and do not settle the request.
 * @param request - task and gate prompt.
 * @returns promise settled by a matching decision, task cancellation, or provider disposal.
 */
abstract requestApproval(request: CoordinationApprovalRequest): Promise<CoordinationApprovalDecision>

/** Resolve a pending approval gate.
 * @param decision - decision matching a pending request.
 */
abstract decideApproval(decision: CoordinationApprovalDecision): void

/** Register an adapter that can answer approval requests. Throwing or rejecting callbacks do not prevent later adapters from running.
 * @param listener - callback receiving each new gate.
 * @returns disposer that unregisters the callback.
 */
abstract onApprovalRequest(listener: CoordinationApprovalRequestListener): () => void

/**
 * Register an audit projection listener, including terminal-run eviction.
 * Throwing or rejecting callbacks cannot alter committed lifecycle state.
 * @param listener - callback for committed lifecycle events.
 * @returns disposer that unregisters the callback.
 */
abstract onEvent(listener: CoordinationEventListener): () => void
```

Source: [`packages/coordination/coordination/src/index.ts`](../../packages/coordination/coordination/src/index.ts)
<!-- END GENERATED cordis-surface -->
