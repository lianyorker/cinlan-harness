/**
 * Durable link records owned by the bridge. The Workspace registry's own
 * records stay unchanged; parent and task relationships live only here.
 * @module @cinlan/worktree-task-workspace/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { WorktreeTaskId } from '@cinlan/worktree-task/types'

const workspaceId = z.string().min(1).transform(value => value as WorkspaceId)

/** One stored link, keyed by the checkout Workspace id. */
export const worktreeTaskWorkspaceLink = z.object({
  taskId: z.string().min(1).transform(value => value as WorktreeTaskId),
  parentWorkspaceId: workspaceId.optional(),
  createdAt: z.string(),
  /** Set once the one-time membership backfill for this checkout has run. */
  backfilledAt: z.string().optional(),
})

/** Stored link record. */
export type WorktreeTaskWorkspaceLinkRecord = z.infer<typeof worktreeTaskWorkspaceLink>

/** Bridge domain: one `links` table keyed by checkout Workspace id. */
export const worktreeTaskWorkspaceSpec = defineDomain({
  name: 'worktree_task_workspaces',
  version: 1,
  tables: {
    links: domainTable<WorkspaceId, WorktreeTaskWorkspaceLinkRecord>(worktreeTaskWorkspaceLink),
  },
})
