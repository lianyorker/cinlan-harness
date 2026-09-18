/** Durable records for Git-backed Worktree Task management. */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { WorktreeTaskId } from '@deepseek-ai/dsh-worktree-task'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

/** Direct program invocation captured by a task or selected for future tasks. */
export const worktreeTaskHook = z.object({
  executable: z.string().min(1).refine(value => !value.includes(String.fromCharCode(0))),
  args: z.array(z.string().refine(value => !value.includes(String.fromCharCode(0)))),
}).strict()

/** Persisted defaults; the provider enforces directory containment before use. */
export const worktreeTaskDefaults = z.object({
  defaultDirectory: z.string(),
  baseRef: z.string().min(1),
  setup: worktreeTaskHook.nullable(),
  cleanup: worktreeTaskHook.nullable(),
}).strict()

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
  linkedIssue: z.url().optional(),
  sessionIds: z.array(z.string().transform(value => brandString<SessionId>(value))),
  head: z.string().regex(/^[0-9a-f]{40,64}$/),
  // Absent in earlier records: those tasks retain their original no-hook lifecycle.
  launch: worktreeTaskDefaults.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** Validated durable record type. */
export type GitWorktreeTaskRecord = z.infer<typeof gitWorktreeTaskRecord>

/** Cleanup claims are durable before execution and remain after task deletion. */
export const cleanupReceipt = z.intersection(
  z.object({
    operation: z.enum(['archive', 'delete']),
    hook: worktreeTaskHook,
    startedAt: z.string(),
  }),
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('running') }),
    z.object({ status: z.literal('succeeded'), finishedAt: z.string() }),
    z.object({ status: z.literal('failed'), finishedAt: z.string() }),
  ]),
)

/** Provider domain. Missing additive tables read empty in the v1 KV document format. */
export const gitWorktreeTaskSpec = defineDomain({
  name: 'worktree_tasks_git',
  version: 1,
  global: {
    schema: z.object({ revision: z.number().int().nonnegative(), value: worktreeTaskDefaults }),
    initial: { revision: 0, value: { defaultDirectory: '', baseRef: 'HEAD', setup: null, cleanup: null } },
  },
  tables: {
    tasks: domainTable<ReturnType<typeof WorktreeTaskId>, GitWorktreeTaskRecord>(gitWorktreeTaskRecord),
    cleanup_receipts: domainTable<ReturnType<typeof WorktreeTaskId>, z.infer<typeof cleanupReceipt>>(cleanupReceipt),
  },
})
