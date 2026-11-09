// @vitest-environment jsdom
/** Terminal titles remain canonical while an editor waits for or retries a Remote write. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TabBar } from '../src/client/TabBar.tsx'

const tab = { id: 'terminal:0', type: 'terminal', title: 'Shell' }
afterEach(() => { cleanup() })
it('keeps the visible title until rename succeeds and retains a failed draft for retry', async () => {
  const pending = Promise.withResolvers<undefined>()
  const rename = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue(undefined)
  render(<TabBar paneId="pane:0" tabs={[tab]} active={tab.id} onActivate={() => {}} onClose={() => {}}
    onNewTab={() => {}} newTabOptions={[]} onDropTab={() => {}} onRename={rename} />)
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Shell' }), { key: 'F2' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Rename terminal' }), { target: { value: 'Build' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save terminal title' }))
  expect(rename).toHaveBeenCalledWith(tab, 'Build')
  expect(screen.getByRole('tab', { name: 'Shell' })).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save terminal title' }).disabled).toBe(true)
  await act(async () => { pending.reject(new Error('stale generation')); await pending.promise.catch(() => {}) })
  expect(screen.getByRole('alert').textContent).toContain('could not be renamed')
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Rename terminal' }).value).toBe('Build')
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save terminal title' })) })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('tab', { name: 'Shell' })).toBeTruthy()
})
it('does not offer title editing for agent-owned terminal tabs', () => {
  const rename = vi.fn()
  render(<TabBar paneId="pane:0" tabs={[{ ...tab, id: 'agent:owned' }]} active="agent:owned" onActivate={() => {}} onClose={() => {}}
    onNewTab={() => {}} newTabOptions={[]} onDropTab={() => {}} onRename={rename} />)
  fireEvent.doubleClick(screen.getByRole('tab', { name: 'Shell' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(rename).not.toHaveBeenCalled()
})
