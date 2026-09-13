/** Task-coordination Service Definition. */
import { Context, Service } from '@deepseek-ai/cordis'
import type {
  CoordinationApprovalDecision, CoordinationApprovalRequest, CoordinationApprovalRequestListener,
  CoordinationEvent, CoordinationEventListener, RunId, RunSnapshot, StartRunRequest, TaskExecutor,
  TaskId, TaskMessage, TaskMessageListener, TaskSnapshot, TaskSpec,
} from './types.ts'

export type * from './types.ts'
export { RunId, TaskId, CoordinationError } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    coordination: CoordinationService
  }
}

/** A live run handle returned by {@link CoordinationService.start}. */
export interface CoordinationRun {
  /** Current detached projection. */
  readonly snapshot: RunSnapshot
  /**
   * Each access returns a promise that resolves to an independently detached projection after every task is
   * terminal and every admitted executor call has settled.
   */
  readonly result: Promise<RunSnapshot>
  /**
   * Cancel all non-terminal tasks in the run.
   * @param reason - diagnostic forwarded as each running executor's `AbortSignal.reason`.
   */
  cancel(reason?: string): void
}

/** Swappable task-coordination capability. */
export abstract class CoordinationService extends Service {
  constructor(ctx: Context) {
    if (new.target === CoordinationService) {
      throw new Error('@deepseek-ai/dsh-coordination is the abstract coordination seam; load @deepseek-ai/dsh-coordination-local')
    }
    super(ctx, 'coordination')
  }

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
}

export type {
  CoordinationApprovalDecision, CoordinationApprovalRequest, CoordinationApprovalRequestListener,
  CoordinationEvent, CoordinationEventListener, RunSnapshot, StartRunRequest, TaskExecutor,
  TaskMessage, TaskMessageListener, TaskSnapshot, TaskSpec,
}

export default CoordinationService
