/** Worktree Task link observation feeding parent hints and group badges. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { WorktreeTaskWorkspaceLinksFrame, WorktreeTaskWorkspaceLinkView } from '@cinlan/api-worktree-task-controller/types'

/** Checkout Workspace id to its task link. */
export type WorktreeTaskLinks = ReadonlyMap<WorkspaceId, WorktreeTaskWorkspaceLinkView>

/** Checkout Workspace id to its source Workspace id. */
export type WorktreeTaskParents = ReadonlyMap<WorkspaceId, WorkspaceId>

/**
 * Follow the Host link stream into two identity-stable snapshot stores.
 * A failed or ended stream clears both stores so stale badges and hints
 * never survive a Host restart.
 * @param follow - generated `followWorkspaceLinks` stream opener.
 * @returns the stores and the awaited disposer.
 */
export function observeWorktreeTaskLinks(
  follow: (signal: AbortSignal) => AsyncIterable<WorktreeTaskWorkspaceLinksFrame>,
) {
  const links = createSnapshotStore<WorktreeTaskLinks>(new Map())
  const parents = createSnapshotStore<WorktreeTaskParents>(new Map())
  const lifetime = new AbortController()
  const consume = async (): Promise<void> => {
    try {
      for await (const frame of follow(lifetime.signal)) {
        if (lifetime.signal.aborted) return
        const nextLinks = new Map<WorkspaceId, WorktreeTaskWorkspaceLinkView>()
        const nextParents = new Map<WorkspaceId, WorkspaceId>()
        for (const link of frame.links) {
          nextLinks.set(link.workspaceId, link)
          if (link.parentWorkspaceId !== undefined) nextParents.set(link.workspaceId, link.parentWorkspaceId)
        }
        if (!sameLinks(links.getSnapshot(), nextLinks)) links.set(nextLinks)
        if (!sameParents(parents.getSnapshot(), nextParents)) parents.set(nextParents)
      }
    } catch {
      if (!lifetime.signal.aborted) {
        links.set(new Map())
        parents.set(new Map())
      }
    }
  }
  void consume()
  return {
    links,
    parents,
    dispose: async (): Promise<void> => {
      lifetime.abort()
    },
  }
}

function sameLinks(
  left: WorktreeTaskLinks,
  right: WorktreeTaskLinks,
): boolean {
  if (left.size !== right.size) return false
  for (const [workspaceId, link] of left) {
    const next = right.get(workspaceId)
    if (next === undefined || !sameLink(link, next)) return false
  }
  return true
}

function sameParents(left: WorktreeTaskParents, right: WorktreeTaskParents): boolean {
  if (left.size !== right.size) return false
  for (const [child, parent] of left) {
    if (right.get(child) !== parent) return false
  }
  return true
}

function sameLink(left: WorktreeTaskWorkspaceLinkView, right: WorktreeTaskWorkspaceLinkView): boolean {
  return left.workspaceId === right.workspaceId
    && left.taskId === right.taskId
    && left.parentWorkspaceId === right.parentWorkspaceId
    && left.createdAt === right.createdAt
    && left.name === right.name
    && left.status === right.status
    && left.linkedIssue === right.linkedIssue
}
