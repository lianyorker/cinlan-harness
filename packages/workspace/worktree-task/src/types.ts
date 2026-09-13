/** Worktree Task types: branded ids, status enum, and domain objects. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identifier for one Worktree Task. */
export type WorktreeTaskId = Branded<'WorktreeTaskId'>

/**
 * Mint a WorktreeTaskId from a string.
 * @param value - Serialized task identifier.
 * @returns The branded Worktree Task identifier.
 */
export function WorktreeTaskId(value: string): WorktreeTaskId {
  return value as WorktreeTaskId
}

/** Lifecycle status of a Worktree Task. */
export type WorktreeTaskStatus =
  | 'active'      // worktree checked out, sessions may bind
  | 'hibernated'  // worktree removed, branch retained
  | 'archived'    // read-only, no mutations allowed

/** Complete Worktree Task domain object. */
export interface WorktreeTask {
  readonly id: WorktreeTaskId
  readonly name: string
  readonly workspaceId: WorkspaceId
  readonly sourcePath: string
  readonly baseRef: string
  readonly branch: string
  readonly checkoutPath: string
  readonly status: WorktreeTaskStatus
  readonly linkedIssue?: string
  readonly sessionIds: readonly SessionId[]
  readonly createdAt: string
  readonly updatedAt: string
}

/** Request to create a new Worktree Task. */
export interface CreateTaskRequest {
  readonly name: string
  readonly workspaceId: WorkspaceId
  readonly sourcePath: string
  readonly baseRef?: string
  readonly linkedIssue?: string
}

/** Request to activate a hibernated task. */
export interface ActivateTaskRequest {
  readonly taskId: WorktreeTaskId
}

/** Request to hibernate an active task. */
export interface HibernateTaskRequest {
  readonly taskId: WorktreeTaskId
}

/** Request to archive a task. */
export interface ArchiveTaskRequest {
  readonly taskId: WorktreeTaskId
}

/** Request to delete a task. */
export interface DeleteTaskRequest {
  readonly taskId: WorktreeTaskId
}

/** Request to bind a session to a task. */
export interface BindSessionRequest {
  readonly taskId: WorktreeTaskId
  readonly sessionId: SessionId
}

/** Result of binding a session. */
export interface BindSessionResult {
  readonly task: WorktreeTask
  readonly checkoutPath: string
}

/** Result of deleting a task. */
export interface DeleteTaskResult {
  readonly deleted: boolean
  readonly retainedBranch?: string
}
