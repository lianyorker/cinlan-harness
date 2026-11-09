import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { WorktreeTaskWorkspaceLinkView } from '@cinlan/api-worktree-task-controller/types'
import type { WorktreeTaskWorkspaceLinksFrame } from '@cinlan/api-worktree-task-controller'
import { describe, expect, it, vi } from 'vitest'
import { observeWorktreeTaskLinks } from '../src/client/links.ts'

function link(patch: Omit<Partial<WorktreeTaskWorkspaceLinkView>, 'parentWorkspaceId'>
  & { parentWorkspaceId?: WorktreeTaskWorkspaceLinkView['parentWorkspaceId'] | undefined } = {}): WorktreeTaskWorkspaceLinkView {
  const { parentWorkspaceId, ...rest } = patch
  return {
    workspaceId: 'ws-checkout' as WorktreeTaskWorkspaceLinkView['workspaceId'],
    taskId: 'task-1' as WorktreeTaskWorkspaceLinkView['taskId'],
    ...(Object.hasOwn(patch, 'parentWorkspaceId')
      ? parentWorkspaceId === undefined ? {} : { parentWorkspaceId }
      : { parentWorkspaceId: 'ws-source' as WorkspaceId }),
    createdAt: '2026-01-01T00:00:00.000Z', name: 'fix-login', status: 'active', ...rest,
  }
}

async function* frames(...values: WorktreeTaskWorkspaceLinksFrame[]): AsyncIterable<WorktreeTaskWorkspaceLinksFrame> {
  for (const value of values) yield value
}

describe('observeWorktreeTaskLinks', () => {
  it('projects baseline and changed frames into identity-stable stores', async () => {
    const first = { type: 'baseline' as const, links: [link()] }
    const observation = observeWorktreeTaskLinks((signal) => {
      void signal
      return frames(first, { type: 'changed' as const, links: first.links })
    })
    await vi.waitFor(() => {
      expect(observation.links.getSnapshot().size).toBe(1)
      expect(observation.parents.getSnapshot().get(WorkspaceId('ws-checkout'))).toBe(WorkspaceId('ws-source'))
    })
    const linksSnapshot = observation.links.getSnapshot()
    const parentsSnapshot = observation.parents.getSnapshot()
    // A changed frame with identical content keeps both snapshot identities.
    await vi.waitFor(() => { expect(observation.links.getSnapshot()).toBe(linksSnapshot) })
    expect(observation.parents.getSnapshot()).toBe(parentsSnapshot)
    await observation.dispose()
  })

  it('updates both stores when a frame changes content', async () => {
    const observation = observeWorktreeTaskLinks((signal) => {
      void signal
      return frames(
        { type: 'baseline', links: [link()] },
        { type: 'changed', links: [link({ parentWorkspaceId: undefined, status: 'hibernated' })] },
      )
    })
    await vi.waitFor(() => {
      expect(observation.parents.getSnapshot().size).toBe(0)
      expect(observation.links.getSnapshot().get(WorkspaceId('ws-checkout'))?.status).toBe('hibernated')
    })
    await observation.dispose()
  })

  it('clears both stores when the stream fails', async () => {
    const observation = observeWorktreeTaskLinks(() => async function* () {
      yield { type: 'baseline', links: [link()] }
      throw new Error('connection lost')
    }())
    await vi.waitFor(() => {
      expect(observation.links.getSnapshot().size).toBe(0)
      expect(observation.parents.getSnapshot().size).toBe(0)
    })
    await observation.dispose()
  })

  it('stops consuming after disposal', async () => {
    const push: ((frame: WorktreeTaskWorkspaceLinksFrame) => void)[] = []
    let release: (() => void) | undefined
    const stream = new ReadableStream<WorktreeTaskWorkspaceLinksFrame>({
      start(controller) {
        push.push(frame => controller.enqueue(frame))
        release = () => controller.close()
      },
    })
    const observation = observeWorktreeTaskLinks((signal) => {
      void signal
      return async function* () {
        const reader = stream.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) return
          yield value!
        }
      }()
    })
    await vi.waitFor(() => { expect(observation.links.getSnapshot().size).toBe(0) })
    push[0]!({ type: 'baseline', links: [link()] })
    await vi.waitFor(() => { expect(observation.links.getSnapshot().size).toBe(1) })
    await observation.dispose()
    push[0]!({ type: 'changed', links: [link({ status: 'archived' })] })
    await new Promise((resolve) => { setTimeout(resolve, 10) })
    expect(observation.links.getSnapshot().get(WorkspaceId('ws-checkout'))?.status).toBe('active')
    release?.()
  })
})
