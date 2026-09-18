/** Worktree Task types: branded ids, status enum, and domain objects. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identifier for one Worktree Task. */
export type WorktreeTaskId = Branded<'WorktreeTaskId'>

/** Lifecycle status of a Worktree Task. */
export type WorktreeTaskStatus =
  | 'active'      // worktree checked out, sessions may bind
  | 'hibernated'  // worktree removed, branch retained
  | 'archived'    // checkout reclaimed; review and safe deletion remain available

/** Durable claim and settlement for a task's captured cleanup program. */
export type WorktreeTaskCleanupReceipt = {
  readonly operation: 'archive' | 'delete'
  readonly hook: WorktreeTaskHook
  readonly startedAt: string
} & (
  | { readonly status: 'running' }
  | { readonly status: 'succeeded' | 'failed'; readonly finishedAt: string }
)

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
  /** Absent before cleanup; an unsettled claim blocks automatic reruns. */
  readonly cleanupReceipt?: WorktreeTaskCleanupReceipt
  readonly linkedIssue?: string
  readonly sessionIds: readonly SessionId[]
  readonly createdAt: string
  readonly updatedAt: string
}

/** A directly executed lifecycle program; shell syntax requires an explicitly selected shell. */
export interface WorktreeTaskHook {
  readonly executable: string
  readonly args: readonly string[]
}

/** Defaults captured by new tasks; changes never rewrite an existing task's launch facts. */
export interface WorktreeTaskDefaults {
  /** Relative directory beneath the provider's managed root; empty uses the root itself. */
  readonly defaultDirectory: string
  readonly baseRef: string
  readonly setup: WorktreeTaskHook | null
  readonly cleanup: WorktreeTaskHook | null
}

/** Revisioned provider-owned defaults and the Host's managed directory. */
export interface WorktreeTaskSettings {
  readonly revision: number
  readonly managedRoot: string
  readonly value: WorktreeTaskDefaults
}

/** Replace defaults only if the caller observed the current revision. */
export interface UpdateWorktreeTaskSettingsRequest {
  readonly expectedRevision: number
  readonly value: WorktreeTaskDefaults
}

/** Complete bounded read-only review against the task's captured base commit. */
export interface WorktreeTaskReview {
  readonly taskId: WorktreeTaskId
  readonly baseHead: string
  readonly head: string
  readonly checkoutRoot: string
  readonly dirty: boolean
  /** Net tracked changes, including staged and unstaged edits while active. */
  readonly patch: string
  /** Untracked paths are listed separately; their contents are not in the patch. */
  readonly untracked: readonly string[]
  /** Captured absolute programs, or null for a task with no hook. */
  readonly setup: WorktreeTaskHook | null
  readonly cleanup: WorktreeTaskHook | null
  readonly cleanupReceipt?: WorktreeTaskCleanupReceipt
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
  /** The provider retains this receipt after the task record is deleted. */
  readonly cleanupReceipt?: WorktreeTaskCleanupReceipt
}
