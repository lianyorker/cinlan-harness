/** Durable records for managed Git worktree leases. */

import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceIsolationLeaseId } from '@deepseek-ai/dsh-workspace-isolation'

/** One provider-owned lease record. */
export const gitWorkspaceIsolationRecord = z.object({
  id: z.uuid().transform(WorkspaceIsolationLeaseId),
  sessionId: z.string().min(1).transform(SessionId),
  sourcePath: z.string().min(1),
  repositoryPath: z.string().min(1),
  checkoutRoot: z.string().min(1),
  checkoutPath: z.string().min(1),
  branch: z.string().min(1),
  phase: z.union([z.literal('active'), z.literal('hibernated')]),
  reviewState: z.union([z.literal('none'), z.literal('branch-retained')]),
  baseBranch: z.string(),
  baseHead: z.string().regex(/^[0-9a-f]{40,64}$/),
  head: z.string().regex(/^[0-9a-f]{40,64}$/),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** Validated durable record type. */
export type GitWorkspaceIsolationRecord = z.infer<typeof gitWorkspaceIsolationRecord>

/** Provider domain. Session ids are the one-lease-per-Session table keys. */
export const gitWorkspaceIsolationSpec = defineDomain({
  name: 'workspace_isolation_git',
  version: 3,
  tables: {
    leases: domainTable<ReturnType<typeof SessionId>, GitWorkspaceIsolationRecord>(gitWorkspaceIsolationRecord),
  },
})
