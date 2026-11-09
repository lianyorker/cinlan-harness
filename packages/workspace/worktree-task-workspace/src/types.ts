/**
 * Public types of the Worktree Task Workspace bridge: one link between a
 * Workspace registered at a task checkout and the task plus source Workspace
 * it derives from.
 * @module @cinlan/worktree-task-workspace/src/types
 */

import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { WorktreeTaskId } from '@cinlan/worktree-task/types'

/** One task checkout Workspace and the Workspace it was derived from. */
export interface WorktreeTaskWorkspaceLink {
  /** Workspace registered at the task's checkout path. */
  readonly workspaceId: WorkspaceId
  /** Task that owns the checkout. */
  readonly taskId: WorktreeTaskId
  /** Source Workspace, when one is registered at the task's source path. */
  readonly parentWorkspaceId?: WorkspaceId
  /** ISO-8601 instant the link was first recorded. */
  readonly createdAt: string
}
