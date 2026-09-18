/**
 * Service Definition for `ctx.worktreeTask`: per-task Git worktree and branch
 * lifecycle, session binding, and state transitions. Providers manage durable
 * storage, Git operations, and worktree checkouts.
 *
 * @module @deepseek-ai/dsh-worktree-task
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  WorktreeTaskId as WorktreeTaskIdBrand,
  WorktreeTask,
  CreateTaskRequest,
  ActivateTaskRequest,
  HibernateTaskRequest,
  ArchiveTaskRequest,
  DeleteTaskRequest,
  BindSessionRequest,
  BindSessionResult,
  DeleteTaskResult,
  WorktreeTaskSettings,
  UpdateWorktreeTaskSettingsRequest,
  WorktreeTaskReview,
} from './types.ts'

export {
  type WorktreeTaskStatus,
  type WorktreeTask,
  type CreateTaskRequest,
  type ActivateTaskRequest,
  type HibernateTaskRequest,
  type ArchiveTaskRequest,
  type DeleteTaskRequest,
  type BindSessionRequest,
  type BindSessionResult,
  type DeleteTaskResult,
  type WorktreeTaskHook,
  type WorktreeTaskCleanupReceipt,
  type WorktreeTaskDefaults,
  type WorktreeTaskSettings,
  type UpdateWorktreeTaskSettingsRequest,
  type WorktreeTaskReview,
} from './types.ts'

/** Identifies one Worktree Task record. */
export type WorktreeTaskId = WorktreeTaskIdBrand

/**
 * Restore the opaque identity from serialized task data.
 * @param value - Serialized task identifier.
 * @returns The branded Worktree Task identifier.
 */
export function WorktreeTaskId(value: string): WorktreeTaskId {
  return value as WorktreeTaskId
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Worktree Task lifecycle provider (optional). */
    worktreeTask: WorktreeTaskService
  }
}

/**
 * Abstract Worktree Task service. Providers create Git worktrees, manage
 * branch lifecycle, bind sessions, and persist task state.
 */
export abstract class WorktreeTaskService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'worktreeTask')
  }

  /**
   * Create a new task with a dedicated branch and worktree checkout.
   * @param request - Task name, workspace, source path, and optional base ref.
   * @param requestSignal - Cancels queued work and setup; process settlement precedes checkout rollback.
   * @returns The created task in active status.
   * @throws WorktreeTaskError when workspace is invalid or Git operation fails.
   */
  abstract create(request: CreateTaskRequest, requestSignal?: AbortSignal): Promise<WorktreeTask>

  /**
   * List all tasks managed by this provider.
   * @returns All task records.
   */
  abstract list(): WorktreeTask[]

  /**
   * Get one task by id.
   * @param taskId - Task identifier.
   * @returns The task record.
   * @throws WorktreeTaskError with code 'not-found' when unknown.
   */
  abstract get(taskId: WorktreeTaskId): WorktreeTask

  /**
   * Read the defaults captured by future task creation.
   * @returns The durable defaults and their revision.
   */
  abstract settings(): WorktreeTaskSettings

  /**
   * Replace defaults without running hooks or modifying existing task launch facts.
   * @param request - Complete defaults and the revision observed by the editor.
   * @param requestSignal - Cancels queued work before the settings write.
   * @returns the persisted defaults and their new revision.
   */
  abstract updateSettings(request: UpdateWorktreeTaskSettingsRequest, requestSignal?: AbortSignal): Promise<WorktreeTaskSettings>

  /**
   * Read tracked changes against the captured base and list untracked paths without mutating Git.
   * @param taskId - Provider-issued task identity.
   * @param requestSignal - Cancellation of queued and active read work.
   * @returns the complete review; exceeding the provider's byte bound rejects.
   */
  abstract review(taskId: WorktreeTaskId, requestSignal?: AbortSignal): Promise<WorktreeTaskReview>

  /**
   * Bind a session to an active task, granting it the checkout path.
   * @param request - Task and session identifiers.
   * @param requestSignal - Cancels queued work before binding the Session.
   * @returns The updated task and checkout path.
   * @throws WorktreeTaskError when task is not active or binding fails.
   */
  abstract bindSession(request: BindSessionRequest, requestSignal?: AbortSignal): Promise<BindSessionResult>

  /**
   * Unbind a session from a task.
   * @param taskId - Task identifier.
   * @param sessionId - Session identifier.
   * @param requestSignal - Cancels queued work before removing the binding.
   * @returns The updated task.
   * @throws WorktreeTaskError with code 'not-found' when unknown.
   */
  abstract unbindSession(taskId: WorktreeTaskId, sessionId: SessionId, requestSignal?: AbortSignal): Promise<WorktreeTask>

  /**
   * Find the task bound to a session, if any.
   * @param sessionId - Session identifier.
   * @returns The bound task, or undefined.
   */
  abstract findForSession(sessionId: SessionId): WorktreeTask | undefined

  /**
   * Activate a hibernated task by restoring its worktree.
   * @param request - Task identifier.
   * @param requestSignal - Cancels queued work and checkout restoration.
   * @returns The task in active status.
   * @throws WorktreeTaskError when task is not hibernated or checkout fails.
   */
  abstract activate(request: ActivateTaskRequest, requestSignal?: AbortSignal): Promise<WorktreeTask>

  /**
   * Hibernate an active task by removing its worktree while retaining the branch.
   * @param request - Task identifier.
   * @param requestSignal - Cancels queued work and checkpoint commands.
   * @returns The task in hibernated status.
   * @throws WorktreeTaskError with code 'busy' when sessions are bound.
   */
  abstract hibernate(request: HibernateTaskRequest, requestSignal?: AbortSignal): Promise<WorktreeTask>

  /**
   * Run captured cleanup, then checkpoint and archive the task. Successful cleanup is never rerun.
   * Failed cleanup retains the checkout; an unsettled durable claim requires manual review before further mutation.
   * @param request - Task identifier; repeating after a settled failure explicitly retries cleanup.
   * @param requestSignal - Cancellation forwarded to queued work and subprocesses; settlement is awaited.
   * @returns The archived task and any cleanup receipt.
   * @throws WorktreeTaskError when sessions are bound, cleanup fails, or its previous outcome is unknown.
   */
  abstract archive(request: ArchiveTaskRequest, requestSignal?: AbortSignal): Promise<WorktreeTask>

  /**
   * Archive through the cleanup lifecycle, then delete only an integrated task branch.
   * Cleanup receipts survive task deletion. An unmerged branch and its archived record remain reviewable.
   * @param request - Task identifier; repeating after a settled failure explicitly retries cleanup.
   * @param requestSignal - Cancellation forwarded to queued work and subprocesses; settlement is awaited.
   * @returns Deletion or retained-branch result and any cleanup receipt.
   * @throws WorktreeTaskError when sessions are bound, cleanup fails, or its previous outcome is unknown.
   */
  abstract delete(request: DeleteTaskRequest, requestSignal?: AbortSignal): Promise<DeleteTaskResult>
}

/** Worktree Task error codes. */
export type WorktreeTaskErrorCode =
  | 'unavailable'        // No provider mounted
  | 'not-found'          // Unknown task id
  | 'busy'               // Sessions bound, cannot mutate
  | 'conflict'           // Task state changed
  | 'invalid-workspace'  // Workspace invalid or inaccessible
  | 'invalid-path'       // Source path invalid
  | 'git-failed'         // Git operation failed
  | 'operation-failed'   // Other provider failure

/** Structured error for Worktree Task operations. */
export class WorktreeTaskError extends Error {
  override readonly name = 'WorktreeTaskError'

  constructor(
    readonly code: WorktreeTaskErrorCode,
    message: string,
    readonly context?: Record<string, unknown>,
  ) {
    super(message)
  }
}
