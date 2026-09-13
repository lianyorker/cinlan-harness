/** Durable records for Git-backed Worktree Task management. */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { WorktreeTaskId } from '@deepseek-ai/dsh-worktree-task'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** One provider-owned Worktree Task record. */
export const gitWorktreeTaskRecord = z.object({
  id: z.uuid().transform(WorktreeTaskId),
  name: z.string().min(1),
  workspaceId: z.string().min(1).transform(value => value as WorkspaceId),
  sourcePath: z.string().min(1),
  repositoryPath: z.string().min(1),
  baseRef: z.string().min(1),
  baseBranch: z.string(),
  baseHead: z.string().regex(/^[0-9a-f]{40,64}$/),
  branch: z.string().min(1),
  checkoutRoot: z.string().min(1),
  checkoutPath: z.string().min(1),
  status: z.union([z.literal('active'), z.literal('hibernated'), z.literal('archived')]),
  linkedIssue: z.string().url().optional(),
  sessionIds: z.array(z.string().transform(value => brandString<SessionId>(value))),
  head: z.string().regex(/^[0-9a-f]{40,64}$/),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** Validated durable record type. */
export type GitWorktreeTaskRecord = z.infer<typeof gitWorktreeTaskRecord>

/** Provider domain. Task ids are the table keys. */
export const gitWorktreeTaskSpec = defineDomain({
  name: 'worktree_tasks_git',
  version: 1,
  tables: {
    tasks: domainTable<ReturnType<typeof WorktreeTaskId>, GitWorktreeTaskRecord>(gitWorktreeTaskRecord),
  },
})
