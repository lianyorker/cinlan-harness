// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { WorkItemView, WorkItemWriteOperation } from '@deepseek-ai/dsh-api-work-items-controller/types'
import { WorkItemWritePanel } from '../src/client/WorkItemWritePanel.tsx'
import { en } from '../src/client/locales.ts'
import type { WorkItemsSectionProps } from '../src/client/WorkItemsSection.tsx'

const selected: WorkItemView = {
  id: 'gitlab:acme/repo#7' as never, source: 'gitlab', externalId: '7', title: 'Issue',
  state: 'opened', url: 'https://gitlab.com/acme/repo/-/issues/7', labels: [], assignees: [], associations: [],
}

const prepared: WorkItemWriteOperation = {
  operationId: 'f186c501-0c91-4c71-88bd-1ff72e8b29b9' as never, source: 'github', scope: 'acme/repo',
  mutation: { kind: 'create', source: 'github', title: 'Original', body: 'Details' },
  status: 'prepared', createdAt: 100, expiresAt: 1000,
}
const props = () => ({
  t: makeTranslate(en), source: 'github' as const, item: undefined,
  prepareWrite: vi.fn(async () => ({ operation: prepared })),
  confirmWrite: vi.fn(async () => ({ operation: { ...prepared, status: 'succeeded' as const } })),
  cancelWrite: vi.fn(async () => ({ operation: { ...prepared, status: 'canceled' as const } })),
  listWrites: vi.fn(async () => ({ operations: [prepared] })),
})
afterEach(cleanup)

it('requires preview and a separate confirm, and confirms only the stored id after edits', async () => {
  const p = props()
  render(<WorkItemWritePanel {...p} />)
  fireEvent.click(screen.getByText(en.writes))
  fireEvent.change(screen.getByRole('textbox', { name: en.writeTitle }), { target: { value: 'Original' } })
  fireEvent.click(screen.getByRole('button', { name: en.writePreview }))
  await waitFor(() => { expect(screen.getByRole('button', { name: en.writeConfirm })).toBeTruthy() })
  expect(p.confirmWrite).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('textbox', { name: en.writeTitle }), { target: { value: 'Not the approved text' } })
  fireEvent.click(screen.getByRole('button', { name: en.writeConfirm }))
  await waitFor(() => { expect(p.confirmWrite).toHaveBeenCalledWith({ operationId: prepared.operationId }, expect.any(AbortSignal)) })
  await waitFor(() => { expect(screen.getByText(en.writeStatusSucceeded)).toBeTruthy() })
  expect(screen.queryByRole('button', { name: en.writeConfirm })).toBeNull()
})

it('restores pending history and cancels without issuing a mutation', async () => {
  const p = props()
  render(<WorkItemWritePanel {...p} />)
  fireEvent.click(screen.getByText(en.writes))
  fireEvent.click(screen.getByRole('button', { name: en.writeHistory }))
  await waitFor(() => { expect(screen.getByRole('button', { name: en.writeCancel })).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: en.writeCancel }))
  await waitFor(() => { expect(screen.getByText(en.writeStatusCanceled)).toBeTruthy() })
  expect(p.confirmWrite).not.toHaveBeenCalled()
})

it('shows an uncertain result without offering a retry button', async () => {
  const p = props()
  p.listWrites = vi.fn(async () => ({ operations: [{ ...prepared, status: 'unknown' as const }] }))
  render(<WorkItemWritePanel {...p} />)
  fireEvent.click(screen.getByText(en.writes))
  fireEvent.click(screen.getByRole('button', { name: en.writeHistory }))
  await waitFor(() => { expect(screen.getByText(en.writeUnknown)).toBeTruthy() })
  expect(screen.queryByRole('button', { name: en.writeConfirm })).toBeNull()
  expect(p.confirmWrite).not.toHaveBeenCalled()
})

it('reveals search targets and preserves state and assignee drafts independently', async () => {
  const p = props()
  const destination = (field: string) => ({ itemId: 'write-' + field, anchorId: 'work-items-write-' + field })
  const view = render(<WorkItemWritePanel {...p} source="gitlab" item={selected} target={destination('state')} />)
  expect(view.container.querySelector('details')?.open).toBe(true)
  expect(p.prepareWrite).not.toHaveBeenCalled()
  fireEvent.change(screen.getByRole('textbox', { name: en.writeStateValue }), { target: { value: 'closed' } })
  view.rerender(<WorkItemWritePanel {...p} source="gitlab" item={selected} target={destination('assignees')} />)
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.writeAssignees }).value).toBe('')
  fireEvent.change(screen.getByRole('textbox', { name: en.writeAssignees }), { target: { value: 'alice, bob' } })
  fireEvent.click(screen.getByRole('button', { name: en.writePreview }))
  await waitFor(() => { expect(p.prepareWrite).toHaveBeenCalledWith({ mutation: { kind: 'assign', id: selected.id, assignees: ['alice', 'bob'] } }, expect.any(AbortSignal)) })
  await waitFor(() => { expect(screen.getByRole('button', { name: en.writePreview }).hasAttribute('disabled')).toBe(false) })
  view.rerender(<WorkItemWritePanel {...p} source="gitlab" item={selected} target={destination('state')} />)
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.writeStateValue }).value).toBe('closed')
  fireEvent.click(screen.getByRole('button', { name: en.writePreview }))
  await waitFor(() => { expect(p.prepareWrite).toHaveBeenLastCalledWith({ mutation: { kind: 'state', id: selected.id, state: 'closed' } }, expect.any(AbortSignal)) })
  view.rerender(<WorkItemWritePanel {...p} source="gitlab" item={selected} target={destination('assignees')} />)
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.writeAssignees }).value).toBe('alice, bob')
  expect(p.confirmWrite).not.toHaveBeenCalled()
})

it('reveals unavailable item fields without inventing a selection or write', () => {
  const p = props()
  const view = render(<WorkItemWritePanel {...p} target={{ itemId: 'write-assignees', anchorId: 'work-items-write-assignees' }} />)
  expect(view.container.querySelector('details')?.open).toBe(true)
  expect(screen.getByRole('textbox', { name: en.writeAssignees }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: en.writePreview }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByText(en.writeSelectItem)).toBeTruthy()
  expect(p.prepareWrite).not.toHaveBeenCalled()
  expect(p.listWrites).not.toHaveBeenCalled()
})

it('retains draft and pending receipt across failed preview, confirmation, and history requests', async () => {
  const p = props()
  p.prepareWrite.mockRejectedValueOnce(new Error('preview unavailable'))
  p.confirmWrite.mockRejectedValueOnce(new Error('confirmation unavailable'))
  p.listWrites.mockRejectedValueOnce(new Error('history unavailable'))
  render(<WorkItemWritePanel {...p} target={{ itemId: 'write-title', anchorId: 'work-items-write-title' }} />)
  fireEvent.change(screen.getByRole('textbox', { name: en.writeTitle }), { target: { value: 'Keep this draft' } })
  fireEvent.click(screen.getByRole('button', { name: en.writePreview }))
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('preview unavailable') })
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.writeTitle }).value).toBe('Keep this draft')
  fireEvent.click(screen.getByRole('button', { name: en.writePreview }))
  await waitFor(() => { expect(screen.getByRole('button', { name: en.writeConfirm })).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: en.writeConfirm }))
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('confirmation unavailable') })
  expect(screen.getByRole('button', { name: en.writeConfirm })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.writeHistory }))
  await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('history unavailable') })
  expect(screen.getByRole('button', { name: en.writeCancel })).toBeTruthy()
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.writeTitle }).value).toBe('Keep this draft')
})

it('cancels outstanding preview on unmount and ignores its late completion', async () => {
  const p = props()
  let resolve!: (value: { operation: WorkItemWriteOperation }) => void
  let signal!: AbortSignal
  const prepareWrite = vi.fn<WorkItemsSectionProps['prepareWrite']>((_request, cancellation) => {
    signal = cancellation
    return new Promise((settle) => { resolve = settle })
  })
  const view = render(<WorkItemWritePanel {...p} prepareWrite={prepareWrite} target={{ itemId: 'write-preview', anchorId: 'work-items-write-preview' }} />)
  fireEvent.click(screen.getByRole('button', { name: en.writePreview }))
  view.unmount()
  expect(signal.aborted).toBe(true)
  resolve({ operation: prepared })
  await prepareWrite.mock.results[0]?.value
  expect(p.confirmWrite).not.toHaveBeenCalled()
})
