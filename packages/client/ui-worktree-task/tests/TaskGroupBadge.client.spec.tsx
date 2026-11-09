// @vitest-environment jsdom
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { allowAllAccess, contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { WorktreeTaskWorkspaceLinkView } from '@cinlan/api-worktree-task-controller/types'
import type { WorktreeTaskId } from '@cinlan/worktree-task/types'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskGroupBadge, type TaskGroupBadgeInjected, type TaskGroupBadgeProps } from '../src/client/TaskGroupBadge.tsx'
import { zh } from '../src/client/locales.ts'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'

afterEach(cleanup)

const unusedHook = (): never => { throw new Error('Task group badge does not read this standard hook') }
const standardProps = {
  usePanelInfo: unusedHook, useSessions: unusedHook, useSessionStatus: unusedHook,
  useSessionRetainInfo: unusedHook, useWorkspaces: unusedHook, useResource: unusedHook,
  ...allowAllAccess, useContextMenu: contextMenuHook(),
} satisfies GlobalStandardProps

function link(patch: Partial<WorktreeTaskWorkspaceLinkView> = {}): WorktreeTaskWorkspaceLinkView {
  return {
    workspaceId: 'ws-checkout' as WorktreeTaskWorkspaceLinkView['workspaceId'],
    taskId: 'task-1' as WorktreeTaskWorkspaceLinkView['taskId'],
    parentWorkspaceId: 'ws-source' as NonNullable<WorktreeTaskWorkspaceLinkView['parentWorkspaceId']>,
    createdAt: '2026-01-01T00:00:00.000Z', name: 'fix-login', status: 'active', linkedIssue: 'https://github.com/x/y/issues/1',
    ...patch,
  }
}

function bench(status: 'active' | 'hibernated' | 'archived' = 'active') {
  const links = createSnapshotStore(new Map<WorktreeTaskWorkspaceLinkView['workspaceId'], WorktreeTaskWorkspaceLinkView>([
    [WorkspaceId('ws-checkout'), link({ status })],
  ]))
  const activate = vi.fn(async () => {})
  const openReview = vi.fn()
  const injected: TaskGroupBadgeInjected = {
    hooks: { worktreeTaskLinks: links },
    activate, openReview,
  }
  const t: TaskGroupBadgeProps['t'] = (key, params) => {
    const value = Object.hasOwn(zh, key) ? zh[key as keyof typeof zh] : key
    return params === undefined ? value : value.replace(/\{(\w+)\}/g, (_, name) => String(params[name]))
  }
  const props = {
    workspaceId: WorkspaceId('ws-checkout'),
    path: '/managed/task-1',
    t,
    ...standardProps,
    ...injected,
    useWorktreeTaskLinks: <T,>(selector: (value: Map<WorktreeTaskWorkspaceLinkView['workspaceId'], WorktreeTaskWorkspaceLinkView>) => T) => selector(links.getSnapshot()),
  } satisfies TaskGroupBadgeProps

  return { props, links, activate, openReview }
}

describe('TaskGroupBadge', () => {
  it('renders nothing for a Workspace without a task link', () => {
    const b = bench()
    b.links.set(new Map())
    const { container } = render(<TaskGroupBadge {...b.props} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders the status badge, issue link, and Review entry for an active task', () => {
    const b = bench('active')
    render(<TaskGroupBadge {...b.props} />)
    expect(screen.getByText('活动')).toBeTruthy()
    const issue = screen.getByRole('link', { name: 'https://github.com/x/y/issues/1' })
    expect(issue.getAttribute('target')).toBe('_blank')
    screen.getByRole('button', { name: '审查' }).click()
    expect(b.openReview).toHaveBeenCalledWith('task-1' as WorktreeTaskId)
    expect(screen.queryByRole('button', { name: '激活' })).toBeNull()
  })

  it('offers activation for a hibernated task', () => {
    const b = bench('hibernated')
    render(<TaskGroupBadge {...b.props} />)
    expect(screen.getByText('已休眠')).toBeTruthy()
    screen.getByRole('button', { name: '激活' }).click()
    expect(b.activate).toHaveBeenCalledWith('task-1' as WorktreeTaskId)
  })
})
