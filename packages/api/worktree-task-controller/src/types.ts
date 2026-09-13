/** Browser-safe requests and projections for Worktree Task management. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorktreeTaskId, WorktreeTaskStatus } from '@deepseek-ai/dsh-worktree-task/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

export type { WorktreeTaskId } from '@deepseek-ai/dsh-worktree-task/types'

/** Detached JSON projection of one Worktree Task. */
export interface WorktreeTaskView {
  readonly taskId: WorktreeTaskId
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
export interface WorktreeTaskCreateRequest {
  readonly name: string
  readonly workspaceId: WorkspaceId
  readonly sourcePath: string
  readonly baseRef?: string
  readonly linkedIssue?: string
}

/** Created Worktree Task. */
export interface WorktreeTaskCreateValue {
  readonly task: WorktreeTaskView
}

/** Request addressing one task by id. */
export interface WorktreeTaskRequest {
  readonly taskId: WorktreeTaskId
}

/** Updated task returned by lifecycle transitions. */
export interface WorktreeTaskValue {
  readonly task: WorktreeTaskView
}

/** Complete task list. */
export interface WorktreeTaskListValue {
  readonly items: readonly WorktreeTaskView[]
}

/** Request to bind a session to a task. */
export interface WorktreeTaskBindSessionRequest {
  readonly taskId: WorktreeTaskId
  readonly sessionId: SessionId
}

/** Result of binding a session to a task. */
export interface WorktreeTaskBindSessionValue {
  readonly task: WorktreeTaskView
  readonly checkoutPath: string
}

/** Deletion response. */
export type WorktreeTaskDeleteValue =
  | { readonly status: 'deleted'; readonly taskId: WorktreeTaskId }
  | { readonly status: 'retained'; readonly taskId: WorktreeTaskId; readonly retainedBranch: string }

/** Lifecycle operation names exposed by the Remote namespace. */
export type WorktreeTaskOperation =
  | 'create'
  | 'list'
  | 'get'
  | 'bindSession'
  | 'activate'
  | 'hibernate'
  | 'archive'
  | 'delete'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No Worktree Task provider is mounted in this Host. */
    'worktree-task/unavailable': {}
    /** A live session prevents the requested task mutation. */
    'worktree-task/busy': { readonly operation: WorktreeTaskOperation; readonly taskId: WorktreeTaskId }
    /** The task identity no longer identifies the requested provider state. */
    'worktree-task/conflict': { readonly operation: WorktreeTaskOperation; readonly taskId: WorktreeTaskId }
    /** The task identity is unknown to the provider. */
    'worktree-task/not-found': { readonly operation: WorktreeTaskOperation; readonly taskId: WorktreeTaskId }
    /** Provider failure that has no narrower Remote classification. */
    'worktree-task/operation-failed': {
      readonly operation: WorktreeTaskOperation
      readonly taskId?: WorktreeTaskId
      readonly providerCode: string
    }
  }
}
