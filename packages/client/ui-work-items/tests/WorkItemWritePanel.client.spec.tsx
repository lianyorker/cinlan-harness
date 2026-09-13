// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { WorkItemWriteOperation } from '@deepseek-ai/dsh-api-work-items-controller/types'
import { WorkItemWritePanel } from '../src/client/WorkItemWritePanel.tsx'
import { en } from '../src/client/locales.ts'

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
