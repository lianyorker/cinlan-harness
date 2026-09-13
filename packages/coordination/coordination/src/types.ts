/** Types shared by coordination Service Providers and Consumers. */
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { RunId, TaskId } from './brand.ts'

export { RunId, TaskId } from './brand.ts'

/** Task lifecycle status. */
export type TaskStatus = 'pending' | 'ready' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** Run lifecycle status derived from its tasks. */
export type RunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** A task declared in a run graph. */
export interface TaskSpec {
  /** Optional id; the provider generates one when omitted and rejects reuse while an earlier task remains retained. */
  id?: TaskId
  /** Human-readable task label. */
  label: string
  /** Task ids that must succeed before this task is admitted. */
  dependencies?: readonly TaskId[]
  /** Registered executor kind. */
  executor: string
  /** Provider-specific input passed to the executor. */
  input?: unknown
  /** Optional parent task used by subtree cancellation; parent links must be acyclic. */
  parentId?: TaskId
}

/** Immutable task projection returned to Consumers. */
export interface TaskSnapshot {
  /** Task identifier. */
  readonly id: TaskId
  /** Owning run identifier. */
  readonly runId: RunId
  /** Human-readable task label. */
  readonly label: string
  /** Tasks that must succeed before admission. */
  readonly dependencies: readonly TaskId[]
  /** Registered executor kind. */
  readonly executor: string
  /** Provider-specific executor input. */
  readonly input: unknown
  /** Optional parent used by subtree cancellation. */
  readonly parentId?: TaskId
  /** Current lifecycle status. */
  readonly status: TaskStatus
  /** Executor output after successful settlement. */
  readonly output?: unknown
  /** Failure detail after unsuccessful settlement. */
  readonly error?: string
  /** Creation time in epoch milliseconds. */
  readonly createdAt: number
  /** Executor admission time in epoch milliseconds. */
  readonly startedAt?: number
  /** Terminal settlement time in epoch milliseconds. */
  readonly finishedAt?: number
}

/** Immutable run projection. */
export interface RunSnapshot {
  /** Run identifier. */
  readonly id: RunId
  /** Lifecycle derived from all owned tasks. */
  readonly status: RunStatus
  /** Tasks in declaration order. */
  readonly taskIds: readonly TaskId[]
  /** Creation time in epoch milliseconds. */
  readonly createdAt: number
  /** Terminal settlement time in epoch milliseconds. */
  readonly finishedAt?: number
}

/** Result returned by a task executor. */
export type TaskOutcome =
  | {
    /** Successful settlement. */
    readonly status: 'succeeded'
    /** Executor result retained on success. */
    readonly output?: unknown
  }
  | {
    /** Failed settlement. */
    readonly status: 'failed'
    /** Executor-provided diagnostic. */
    readonly error: string
  }
  | {
    /** Cancelled settlement. */
    readonly status: 'cancelled'
    /** Optional executor-provided cancellation diagnostic. */
    readonly error?: string
  }

/**
 * Executor invoked for one admitted task. Cancellation is delivered through
 * the signal, and provider disposal may wait for the returned promise to settle.
 */
export type TaskExecutor = (
  task: TaskSnapshot,
  signal: AbortSignal,
) => TaskOutcome | Promise<TaskOutcome>

/** Start request for one task graph. */
export interface StartRunRequest {
  /** Complete initial task graph. */
  tasks: readonly TaskSpec[]
}

/** Task-level message. */
export interface TaskMessage {
  /** Recipient task. */
  readonly taskId: TaskId
  /** Message text. */
  readonly message: string
  /** Optional sender label. */
  readonly sender?: string
  /** Commit time in epoch milliseconds. */
  readonly createdAt: number
}

/** Approval gate attached to a task. */
export interface CoordinationApprovalRequest {
  /** Task whose progress requires the decision. */
  readonly taskId: TaskId
  /** Task-local gate identifier. */
  readonly gateId: string
  /** Prompt presented by the approval adapter. */
  readonly prompt: string
}

/** Approval decision. */
export interface CoordinationApprovalDecision extends CoordinationApprovalRequest {
  /** Whether the requested action is approved. */
  readonly approved: boolean
  /** Decision time in epoch milliseconds. */
  readonly decidedAt: number
}

/**
 * Adapter hook for routing approval requests to a human or policy service.
 * A callback must call `decideApproval`; return settlement alone does not decide the gate.
 */
export type CoordinationApprovalRequestListener = (
  request: CoordinationApprovalRequest,
) => void | PromiseLike<void>

/** Authoritative coordination lifecycle event for audit projections. */
export type CoordinationEvent =
  | { readonly type: 'run/started'; readonly run: RunSnapshot }
  | { readonly type: 'run/ended'; readonly run: RunSnapshot }
  | { readonly type: 'run/evicted'; readonly run: RunSnapshot }
  | { readonly type: 'task/changed'; readonly task: TaskSnapshot }
  | { readonly type: 'task/message'; readonly message: TaskMessage }
  | { readonly type: 'task/approval-requested'; readonly request: CoordinationApprovalRequest }
  | { readonly type: 'task/approval-decided'; readonly decision: CoordinationApprovalDecision }
  | { readonly type: 'task/cancelled'; readonly task: TaskSnapshot }

/** Callback for committed lifecycle events. Provider dispatchers isolate thrown and rejected callbacks. */
export type CoordinationEventListener = (event: CoordinationEvent) => void | PromiseLike<void>

/** Callback for task messages. Provider dispatchers isolate thrown and rejected callbacks. */
export type TaskMessageListener = (message: TaskMessage) => void | PromiseLike<void>

/** Typed diagnostic taxonomy for fail-closed coordination operations. */
export type CoordinationErrorCode =
  | 'INVALID_RUN'
  | 'INVALID_TASK'
  | 'DUPLICATE_TASK'
  | 'UNKNOWN_TASK'
  | 'UNKNOWN_RUN'
  | 'DEPENDENCY_MISSING'
  | 'DEPENDENCY_CYCLE'
  | 'PARENT_CYCLE'
  | 'EXECUTOR_UNAVAILABLE'
  | 'RESOURCE_LIMIT'
  | 'INVALID_TRANSITION'
  | 'APPROVAL_UNAVAILABLE'
  | 'APPROVAL_PENDING'

/** Machine-routable coordination failure. */
export class CoordinationError extends HarnessError {
  constructor(message: string, code: CoordinationErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'CoordinationError'
  }
}
