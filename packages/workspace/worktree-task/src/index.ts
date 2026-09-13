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
  WorktreeTaskId,
  WorktreeTask,
  CreateTaskRequest,
  ActivateTaskRequest,
  HibernateTaskRequest,
  ArchiveTaskRequest,
  DeleteTaskRequest,
  BindSessionRequest,
  BindSessionResult,
  DeleteTaskResult,
} from './types.ts'

export {
  WorktreeTaskId,
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
} from './types.ts'

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
   * @returns The created task in active status.
   * @throws WorktreeTaskError when workspace is invalid or Git operation fails.
   */
  abstract create(request: CreateTaskRequest): Promise<WorktreeTask>

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
   * Bind a session to an active task, granting it the checkout path.
   * @param request - Task and session identifiers.
   * @returns The updated task and checkout path.
   * @throws WorktreeTaskError when task is not active or binding fails.
   */
  abstract bindSession(request: BindSessionRequest): Promise<BindSessionResult>

  /**
   * Unbind a session from a task.
   * @param taskId - Task identifier.
   * @param sessionId - Session identifier.
   * @returns The updated task.
   * @throws WorktreeTaskError with code 'not-found' when unknown.
   */
  abstract unbindSession(taskId: WorktreeTaskId, sessionId: SessionId): Promise<WorktreeTask>

  /**
   * Find the task bound to a session, if any.
   * @param sessionId - Session identifier.
   * @returns The bound task, or undefined.
   */
  abstract findForSession(sessionId: SessionId): WorktreeTask | undefined

  /**
   * Activate a hibernated task by restoring its worktree.
   * @param request - Task identifier.
   * @returns The task in active status.
   * @throws WorktreeTaskError when task is not hibernated or checkout fails.
   */
  abstract activate(request: ActivateTaskRequest): Promise<WorktreeTask>

  /**
   * Hibernate an active task by removing its worktree while retaining the branch.
   * @param request - Task identifier.
   * @returns The task in hibernated status.
   * @throws WorktreeTaskError with code 'busy' when sessions are bound.
   */
  abstract hibernate(request: HibernateTaskRequest): Promise<WorktreeTask>

  /**
   * Archive a task, making it read-only.
   * @param request - Task identifier.
   * @returns The task in archived status.
   * @throws WorktreeTaskError with code 'busy' when sessions are bound.
   */
  abstract archive(request: ArchiveTaskRequest): Promise<WorktreeTask>

  /**
   * Delete a task, removing its worktree and optionally its branch.
   * @param request - Task identifier.
   * @returns Deletion result indicating whether the branch was retained.
   * @throws WorktreeTaskError with code 'busy' when sessions are bound.
   */
  abstract delete(request: DeleteTaskRequest): Promise<DeleteTaskResult>
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
