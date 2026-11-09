// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkItemView } from '@cinlan/api-work-items-controller/types'
import type { WorkItemsPanelProps } from '../src/client/WorkItemsPanel.tsx'
import { WorkItemsPanel } from '../src/client/WorkItemsPanel.tsx'
import { en } from '../src/client/locales.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'

const VISIBLE_SOURCES = { githubVisible: true, gitlabVisible: true, giteeVisible: true, jiraVisible: true, linearVisible: true }
const item: WorkItemView = {
  id: 'github:acme/repo#7' as never, source: 'github', externalId: '7', key: '#7', title: 'Fix login',
  body: 'Check the login flow.', state: 'open', url: 'https://github.com/acme/repo/issues/7',
  labels: ['bug'], assignees: ['alice'], associations: [],
}

function props(): WorkItemsPanelProps {
  return {
    t: makeTranslate(en),
    list: vi.fn(async () => ({ items: [item], truncated: false })),
    get: vi.fn(async () => item),
    hooks: {
      settings: {
        getSnapshot: () => ({ value: VISIBLE_SOURCES }),
        subscribe: () => () => {},
      },
    },
    useSettings: (selector: (snapshot: { value: Record<string, boolean> }) => unknown) => selector({ value: VISIBLE_SOURCES }),
  } as WorkItemsPanelProps
}

afterEach(cleanup)

describe('Work Items panel', () => {
  it('filters provider requests and reads selected details', async () => {
    const p = props()
    render(<WorkItemsPanel {...p} />)
    await waitFor(() => expect(p.list).toHaveBeenLastCalledWith({ source: 'github', state: 'open' }, expect.any(AbortSignal)))
    fireEvent.change(screen.getByRole('combobox', { name: en.source }), { target: { value: 'gitlab' } })
    fireEvent.change(screen.getByRole('combobox', { name: en.state }), { target: { value: 'closed' } })
    fireEvent.change(screen.getByRole('textbox', { name: en.search }), { target: { value: 'fix' } })
    await waitFor(() => expect(p.list).toHaveBeenLastCalledWith({ source: 'gitlab', state: 'closed', query: 'fix' }, expect.any(AbortSignal)))
    fireEvent.click(screen.getByRole('button', { name: /Fix login/ }))
    await waitFor(() => expect(p.get).toHaveBeenCalledWith({ id: item.id }, expect.any(AbortSignal)))
    expect(await screen.findByRole('heading', { level: 2, name: 'Fix login' })).toBeTruthy()
  })

  it('follows provider cursors, refreshes, and preserves the prior page on failure', async () => {
    const p = props()
    p.list = vi.fn().mockResolvedValueOnce({ items: [item], nextCursor: 'page-2', truncated: false })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [item], nextCursor: 'page-2', truncated: false })
      .mockResolvedValue({ items: [item], truncated: false })
    render(<WorkItemsPanel {...p} />)
    await waitFor(() => expect(screen.getByRole('button', { name: en.next }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: en.next }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('offline'))
    expect(screen.getByRole('button', { name: /Fix login/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    await waitFor(() => expect(p.list).toHaveBeenLastCalledWith({ source: 'github', state: 'open' }, expect.any(AbortSignal)))
    await waitFor(() => expect(screen.getByRole('button', { name: en.next }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: en.next }))
    await waitFor(() => expect(p.list).toHaveBeenLastCalledWith({ source: 'github', state: 'open', cursor: 'page-2' }, expect.any(AbortSignal)))
  })
})
