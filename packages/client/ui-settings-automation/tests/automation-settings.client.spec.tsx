// @vitest-environment jsdom
/** User-visible drafts, admission retries, and evidence-based execution controls. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutomationClientSnapshot, AutomationRunStatus } from '@deepseek-ai/dsh-api-automation-controller/types'
import { AutomationSettingsSection } from '../src/client/AutomationSettingsSection.tsx'
import type { AutomationSettingsProps } from '../src/client/types.ts'
import { en, zh, type AutomationSettingsKey } from '../src/client/locales.ts'
import type {} from '../src/client/index.ts'
import { definition, run, snapshot } from './fixtures.client.ts'

afterEach(cleanup)

function bench(language: 'en' | 'zh' = 'en', initial = snapshot()) {
  let state: AutomationClientSnapshot = initial
  const copy = language === 'en' ? en : zh
  const create = vi.fn<AutomationSettingsProps['create']>(async () => definition())
  const update = vi.fn<AutomationSettingsProps['update']>(async () => definition())
  const invoke = vi.fn<AutomationSettingsProps['run']>(async () => run())
  const cancel = vi.fn<AutomationSettingsProps['cancel']>(async () => {})
  const deleteTask = vi.fn<AutomationSettingsProps['deleteTask']>(async () => {})
  const loadRuns = vi.fn<AutomationSettingsProps['loadRuns']>(async () => {})
  const loadMoreRuns = vi.fn<AutomationSettingsProps['loadMoreRuns']>(async () => {})
  const refresh = vi.fn<AutomationSettingsProps['refresh']>(async () => {})
  const openSession = vi.fn()
  const close = vi.fn()
  // This section reads none of the global Session/Workspace seats.
  const props = { useAutomation: select => select(state), create, update, run: invoke, cancel, deleteTask,
    loadRuns, loadMoreRuns, refresh, openSession, close,
    t: (key: AutomationSettingsKey, values?: Record<string, string | number>) => Object.entries(values ?? {}).reduce< string>((text, [name, value]) => text.replace('{' + name + '}', String(value)), copy[key]),
  } as AutomationSettingsProps
  const view = render(<AutomationSettingsSection {...props} />)
  return { ...view, props, copy, create, update, invoke, cancel, deleteTask, loadRuns, loadMoreRuns, refresh, openSession, close,
    setState(next: AutomationClientSnapshot) { state = next; view.rerender(<AutomationSettingsSection {...props} />) },
  }
}

function fillCreate(copy: typeof en | typeof zh) {
  fireEvent.click(screen.getByRole('button', { name: copy.newTask }))
  fireEvent.change(screen.getByRole('textbox', { name: copy.taskTitle }), { target: { value: 'New task' } })
  fireEvent.change(screen.getByRole('textbox', { name: copy.prompt }), { target: { value: 'Do work' } })
  fireEvent.change(screen.getByRole('combobox', { name: copy.workspace }), { target: { value: 'workspace-1' } })
}

describe('automation settings', () => {
  it.each(['en', 'zh'] as const)('records the read-only page in %s', (language) => {
    const b = bench(language, { ...snapshot(), writable: false })
    expect({
      heading: screen.getByRole('heading', { level: 1 }).textContent,
      notice: screen.getByRole('status').textContent,
      sections: [...b.container.querySelectorAll('[data-settings-anchor] > h2')].map(node => node.textContent),
      actions: screen.getAllByRole<HTMLButtonElement>('button').map(button => ({ label: button.textContent, disabled: button.disabled })),
    }).toMatchSnapshot()
  })

  it('allows discarding a preserved draft after the connection becomes read-only', () => {
    const b = bench()
    fillCreate(en)
    b.setState({ ...snapshot(), writable: false })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.save }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.discard }))
    expect(screen.queryByRole('textbox', { name: en.taskTitle })).toBeNull()
    expect(b.create).not.toHaveBeenCalled()
  })
  it.each(['en', 'zh'] as const)('creates a disabled weekly draft using Sunday zero in %s', async (language) => {
    const b = bench(language)
    fillCreate(b.copy)
    fireEvent.change(screen.getByRole('combobox', { name: b.copy.schedule }), { target: { value: 'weekly' } })
    fireEvent.click(screen.getByRole('button', { name: b.copy.save }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', b.copy.invalid)
    expect(b.create).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: b.copy.sunday }))
    fireEvent.change(screen.getByRole('spinbutton', { name: b.copy.hour }), { target: { value: '13' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: b.copy.minute }), { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: b.copy.save }))
    await screen.findByText(b.copy.saved)
    expect(b.create).toHaveBeenCalledWith({ title: 'New task', prompt: 'Do work', workspaceId: 'workspace-1', agentPresetId: 'agent-1',
      model: { provider: 'provider-1', model: 'model-1' }, permissionPresetId: 'permission-1', schedule: { kind: 'weekly', weekdays: [0], hour: 13, minute: 45 } })
    expect(b.update).not.toHaveBeenCalled()
    expect(b.invoke).not.toHaveBeenCalled()
  })

  it('retains the first edit revision and failed draft after a conflicting snapshot', async () => {
    const b = bench()
    b.update.mockRejectedValue({ failure: { code: 'conflict', message: 'private data' } })
    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    fireEvent.change(screen.getByRole('textbox', { name: en.taskTitle }), { target: { value: 'Retain this draft' } })
    const next = snapshot()
    b.setState({ ...next, runtime: { ...next.runtime as Extract<NonNullable<typeof next.runtime>, { status: 'ready' }>, definitions: [{ ...definition(), revision: 8, enabled: true }] } })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByText(en.conflict)
    expect(b.update.mock.calls[0]?.[0]).toMatchObject({ expectedRevision: 7, enabled: false, draft: { title: 'Retain this draft' } })
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.taskTitle }).value).toBe('Retain this draft')
    fireEvent.click(screen.getByRole('button', { name: en.discard }))
    expect(screen.queryByRole('textbox', { name: en.taskTitle })).toBeNull()
  })

  it('keeps rejected creation input and never shows a saved message', async () => {
    const b = bench()
    b.create.mockRejectedValue(new Error('private provider error'))
    fillCreate(en)
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByText(en.operationFailed)
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.prompt }).value).toBe('Do work')
    expect(screen.queryByText(en.saved)).toBeNull()
    expect(screen.queryByText('private provider error')).toBeNull()
  })

  it('runs while disabled, preserves one request across retry, and mints another for a deliberate Run', async () => {
    const b = bench()
    b.invoke.mockRejectedValueOnce(new Error('transport'))
    fireEvent.click(screen.getByRole('button', { name: en.run }))
    await screen.findByText(en.runUncertain)
    const first = b.invoke.mock.calls[0]![0]
    expect(first).toMatchObject({ id: 'task-1', expectedRevision: 7 })
    expect(first.requestId).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.retryRun }))
    await waitFor(() => { expect(screen.queryByText(en.runUncertain)).toBeNull() })
    expect(b.invoke.mock.calls[1]![0]).toEqual(first)
    fireEvent.click(screen.getByRole('button', { name: en.run }))
    await waitFor(() => { expect(b.invoke).toHaveBeenCalledTimes(3) })
    expect(b.invoke.mock.calls[2]![0].requestId).not.toBe(first.requestId)
    expect(b.update).not.toHaveBeenCalled()
  })

  it('does not label an explicitly rejected Run as an uncertain admission', async () => {
    const b = bench()
    b.invoke.mockRejectedValue({ failure: { code: 'conflict' } })
    fireEvent.click(screen.getByRole('button', { name: en.run }))
    await screen.findByText(en.conflict)
    expect(screen.queryByRole('button', { name: en.retryRun })).toBeNull()
    expect(screen.queryByText(en.runUncertain)).toBeNull()
  })

  it('enables explicitly, cancels actual active work, and refuses deletion until terminal', async () => {
    const b = bench()
    fireEvent.click(screen.getByRole('button', { name: en.enable }))
    await waitFor(() => { expect(b.update).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 7, enabled: true })) })
    const next = snapshot()
    b.setState({ ...next, runtime: { ...next.runtime as Extract<NonNullable<typeof next.runtime>, { status: 'ready' }>, definitions: [{ ...definition(), enabled: true }], activeRuns: [run('running')] } })
    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: en.cancelRun }).disabled).toBe(false) })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.delete }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.cancelRun }))
    await waitFor(() => { expect(b.cancel).toHaveBeenCalledWith('run-1') })
    b.setState(next)
    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: en.delete }).disabled).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: en.delete }))
    expect(b.deleteTask).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.deleteConfirm }))
    await waitFor(() => { expect(b.deleteTask).toHaveBeenCalledWith({ id: 'task-1', expectedRevision: 7 }) })
  })

  it.each(['loading', 'unavailable', 'readonly'] as const)('disables mutations but retains reveal anchors when %s', (state) => {
    const initial = snapshot()
    const b = bench('zh', { ...initial, availability: state === 'readonly' ? 'ready' : state, writable: state !== 'readonly' })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.newTask }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.run }).disabled).toBe(true)
    expect(screen.getByText(zh[state])).toBeTruthy()
    for (const name of ['tasks', 'draft', 'journal']) {
      const anchor = b.container.querySelector<HTMLElement>('[data-settings-anchor="' + name + '"]')!
      anchor.focus()
      expect(document.activeElement).toBe(anchor)
    }
    expect(b.create).not.toHaveBeenCalled()
    expect(b.invoke).not.toHaveBeenCalled()
  })

  it('requests real journal pages and opens only recorded Sessions', async () => {
    const b = bench()
    fireEvent.click(screen.getByRole('button', { name: en.showRuns }))
    await waitFor(() => { expect(b.loadRuns).toHaveBeenCalledWith('task-1') })
    const entry = run()
    b.setState({ ...snapshot(),
      history: { automationId: entry.automationId, runs: [entry], nextCursor: entry.id, loading: false, error: null } })
    await screen.findByText(en.completedHelp)
    expect(screen.getByText('2026-01-02T03:04:00.000Z')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.openSession }))
    expect(b.openSession).toHaveBeenCalledWith('session-1')
    expect(b.close).toHaveBeenCalledOnce()
    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: en.more }).disabled).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: en.more }))
    await waitFor(() => { expect(b.loadMoreRuns).toHaveBeenCalledOnce() })
    b.setState({ ...snapshot(), history: { automationId: entry.automationId, runs: [{ ...entry, sessionId: null }], nextCursor: null, loading: false, error: { code: 'transport', message: 'raw' } } })
    expect(screen.getByText(en.noSession)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(en.journalFailed)
    expect(screen.queryByRole('button', { name: en.openSession })).toBeNull()
  })

  it('does not offer Cancel for a historical run absent from the active snapshot', () => {
    const item = run('running')
    const b = bench('en', { ...snapshot(), history: {
      automationId: item.automationId, runs: [item], nextCursor: null, loading: false, error: null,
    } })
    expect(screen.queryByRole('button', { name: en.cancelRun })).toBeNull()
    const next = snapshot()
    b.setState({ ...next, runtime: {
      ...next.runtime as Extract<NonNullable<typeof next.runtime>, { status: 'ready' }>, activeRuns: [run('stopping')],
    } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.cancelRun }).disabled).toBe(true)
  })

  it.each<AutomationRunStatus>(['starting', 'running', 'stopping', 'completed', 'failed', 'cancelled', 'skipped-overlap', 'interrupted', 'ambiguous'])('labels %s from recorded evidence only', (status) => {
    const item = run(status)
    bench('en', { ...snapshot(), history: { automationId: item.automationId, runs: [item], nextCursor: null, loading: false, error: null } })
    expect(screen.getByText(content => content.startsWith(en[status] + ' · '))).toBeTruthy()
    if (status === 'interrupted' || status === 'ambiguous') expect(screen.getByText(en.review)).toBeTruthy()
    expect(screen.queryByText(/business success/i)).toBeNull()
  })
})
