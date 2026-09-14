// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkItemView } from '@deepseek-ai/dsh-api-work-items-controller/types'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { WorkItemsSection, type WorkItemsSectionProps } from '../src/client/WorkItemsSection.tsx'
import { en } from '../src/client/locales.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'

const workspace: WorkspaceSnapshot['items'][number] = {
  workspaceId: 'workspace-1' as never, title: 'Product', path: '/product',
  sessionIds: ['session-1' as never], createdAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:00Z',
}
const item: WorkItemView = {
  id: 'github:acme/repo#7' as never, source: 'github', externalId: '7', key: '#7', title: 'Fix login',
  body: 'Check the login flow.', state: 'open', url: 'https://github.com/acme/repo/issues/7',
  labels: ['bug'], assignees: ['alice'], associations: [],
}
function props(): WorkItemsSectionProps {
  const snapshot: WorkspaceSnapshot = { items: [workspace], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null }
  return {
    t: makeTranslate(en),
    prepareWrite: vi.fn(), confirmWrite: vi.fn(), cancelWrite: vi.fn(),
    listWrites: vi.fn(async () => ({ operations: [] })),
    useWorkspaces: selector => selector(snapshot),
    list: vi.fn(async () => ({ items: [item], truncated: false })),
    get: vi.fn(async () => item),
    associate: vi.fn<WorkItemsSectionProps['associate']>(async request => ({ associations: [{ workspaceId: request.workspaceId, workspaceTitle: 'Product', ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }) }] })),
    disassociate: vi.fn(async () => ({ associations: [] })),
    checkIntegration: vi.fn(async () => ({ provider: 'github', status: 'connected', reason: 'connected', account: 'octocat' })),
    close: vi.fn(),
    settings: {
      getSnapshot: vi.fn(() => ({ status: 'ready', value: { githubVisible: true, gitlabVisible: true, linearVisible: true }, base: undefined, user: undefined, revision: 1, writable: true, mode: 'host' })),
      subscribe: vi.fn(() => () => {}),
      set: vi.fn(async () => {}),
      unset: vi.fn(async () => {}),
      mutate: vi.fn(async () => {}),
    },
  } as WorkItemsSectionProps
}
async function select(): Promise<void> {
  await waitFor(() =>{  expect(screen.getByRole('button', { name: /Fix login/ })).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: /Fix login/ }))
  await waitFor(() =>{  expect(screen.getByRole('heading', { level: 3, name: 'Fix login' })).toBeTruthy() })
}
async function scope(): Promise<void> {
  fireEvent.change(screen.getByRole('combobox', { name: en.workspaceContext }), { target: { value: workspace.workspaceId } })
  await select()
}
afterEach(cleanup)

describe('Work Items Settings', () => {
  it('reads real association fields and submits explicit owned Session links', async () => {
    const p = props()
    render(<WorkItemsSection {...p} />)
    await scope()
    fireEvent.change(screen.getByRole('combobox', { name: en.session }), { target: { value: 'session-1' } })
    fireEvent.click(screen.getByRole('button', { name: en.associate }))
    await waitFor(() =>{  expect(p.associate).toHaveBeenCalledWith({ id: item.id, workspaceId: workspace.workspaceId, sessionId: 'session-1' }, expect.any(AbortSignal)) })
    await waitFor(() =>{  expect(screen.getByRole('button', { name: en.disassociate })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en.disassociate }))
    await waitFor(() =>{  expect(p.disassociate).toHaveBeenCalledWith({ id: item.id, workspaceId: workspace.workspaceId, sessionId: 'session-1' }, expect.any(AbortSignal)) })
    await waitFor(() =>{  expect(screen.getByText(en.noWorkspace)).toBeTruthy() })
  })

  it('keeps links unchanged when a durable write fails and allows retry', async () => {
    const p = props()
    p.associate = vi.fn().mockRejectedValueOnce(new Error('disk unavailable')).mockResolvedValue({ associations: [{ workspaceId: workspace.workspaceId, workspaceTitle: 'Product' }] })
    render(<WorkItemsSection {...p} />)
    await scope()
    fireEvent.click(screen.getByRole('button', { name: en.associate }))
    await waitFor(() =>{  expect(screen.getByRole('alert').textContent).toContain('disk unavailable') })
    expect(screen.queryByRole('button', { name: en.disassociate })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.associate }))
    await waitFor(() =>{  expect(screen.getByRole('button', { name: en.disassociate })).toBeTruthy() })
  })

  it('ignores a late association receipt after switching provider', async () => {
    const p = props()
    let settle!: (value: { associations: [] }) => void
    let signal!: AbortSignal
    p.associate = vi.fn<WorkItemsSectionProps['associate']>((_request, cancellation) => {
      signal = cancellation
      return new Promise((resolve) => { settle = resolve })
    })
    render(<WorkItemsSection {...p} />)
    await scope()
    fireEvent.click(screen.getByRole('button', { name: en.associate }))
    fireEvent.change(screen.getByRole('combobox', { name: en.source }), { target: { value: 'linear' } })
    await waitFor(() =>{  expect(signal.aborted).toBe(true) })
    settle({ associations: [] })
    await waitFor(() =>{  expect(screen.getByText(en.noSelection)).toBeTruthy() })
    expect(screen.queryByRole('heading', { level: 3, name: 'Fix login' })).toBeNull()
  })

  it('ignores superseded detail responses and does not present stale list data as detail on error', async () => {
    const p = props()
    let settle!: (value: WorkItemView) => void
    let signal!: AbortSignal
    p.get = vi.fn<WorkItemsSectionProps['get']>((_request, cancellation) => {
      signal = cancellation
      return new Promise((resolve) => { settle = resolve })
    })
    render(<WorkItemsSection {...p} />)
    await waitFor(() =>{  expect(screen.getByRole('button', { name: /Fix login/ })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /Fix login/ }))
    fireEvent.change(screen.getByRole('combobox', { name: en.state }), { target: { value: 'closed' } })
    await waitFor(() =>{  expect(signal.aborted).toBe(true) })
    settle(item)
    await waitFor(() =>{  expect(screen.getByText(en.noSelection)).toBeTruthy() })
    cleanup()
    p.get = vi.fn().mockRejectedValue(new Error('not found'))
    render(<WorkItemsSection {...p} />)
    await waitFor(() =>{  expect(screen.getByRole('button', { name: /Fix login/ })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /Fix login/ }))
    await waitFor(() =>{  expect(screen.getByRole('alert').textContent).toContain('not found') })
    expect(screen.queryByRole('button', { name: en.associate })).toBeNull()
  })

  it('follows cursors and retains page history when the next request fails', async () => {
    const p = props()
    p.list = vi.fn().mockResolvedValueOnce({ items: [item], nextCursor: 'next', truncated: true })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ items: [item], truncated: false })
    render(<WorkItemsSection {...p} />)
    await waitFor(() =>{  expect(screen.getByText(en.truncated)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en.next }))
    await waitFor(() =>{  expect(screen.getByRole('alert').textContent).toContain('offline') })
    expect(screen.getByRole('button', { name: en.previous }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    await waitFor(() =>{  expect(screen.queryByRole('alert')).toBeNull() })
  })

  it('uses live Workspace state and hides deleted association targets', async () => {
    const p = props()
    const view = render(<WorkItemsSection {...p} />)
    await scope()
    const snapshot: WorkspaceSnapshot = { items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null }
    view.rerender(<WorkItemsSection {...p} useWorkspaces={selector => selector(snapshot)} />)
    await waitFor(() =>{  expect(screen.queryByRole('option', { name: 'Product' })).toBeNull() })
    expect(screen.queryByRole('button', { name: en.associate })).toBeNull()
    await waitFor(() =>{  expect(p.list).toHaveBeenLastCalledWith({ source: 'github', state: 'open' }, expect.any(AbortSignal)) })
  })
})
