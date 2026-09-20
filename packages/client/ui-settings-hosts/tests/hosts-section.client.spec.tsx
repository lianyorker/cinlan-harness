// @vitest-environment jsdom
/** Native settings user behavior with typed callbacks and the renderer's observable binding. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ListTargetsValue } from '@deepseek-ai/dsh-api-execution-host-controller/types'
import { HostsSection } from '../src/client/HostsSection.tsx'
import type { HostsProps, HostsSnapshot } from '../src/client/types.ts'
import { en, zh } from '../src/client/locales.ts'
import { baseline, deferred, failure, inspection, readyTarget, target, runtimeInspection, runtimeTask } from './fixtures.client.ts'
import type {} from '../src/client/index.ts'

afterEach(cleanup)
function bench(language: 'en' | 'zh' = 'en', value: ListTargetsValue = baseline) {
  const copy = language === 'en' ? en : zh
  const source = createSnapshotStore<HostsSnapshot>({ status: 'ready', value, error: undefined })
  const callbacks = {
    refreshRuntimes: vi.fn<HostsProps['refreshRuntimes']>(async () => {}),
    detectRuntime: vi.fn<HostsProps['detectRuntime']>(async () => runtimeInspection),
    startRuntime: vi.fn<HostsProps['startRuntime']>(async () => ({ task: runtimeTask })),
    cancelRuntimeTask: vi.fn<HostsProps['cancelRuntimeTask']>(async () => ({ task: { ...runtimeTask, state: 'cancelled' } })),
    refresh: vi.fn<HostsProps['refresh']>(async () => value),
    create: vi.fn<HostsProps['create']>(async () => ({ target })),
    update: vi.fn<HostsProps['update']>(async () => ({ target })),
    removeTarget: vi.fn<HostsProps['removeTarget']>(async () => ({})),
    connect: vi.fn<HostsProps['connect']>(async () => ({ target: readyTarget })),
    disconnect: vi.fn<HostsProps['disconnect']>(async () => ({ target })),
    inspectDirectory: vi.fn<HostsProps['inspectDirectory']>(async () => ({ target: readyTarget, inspection })),
  }
  // This section consumes no session or workspace standard seats.
  const props = { ...callbacks, useRuntimes: selector => selector({ status: 'ready', tasks: [], error: undefined }), useHosts: bindSnapshotSelector(source), t: makeTranslate(copy) } as HostsProps
  const view = render(<HostsSection {...props} />)
  return { ...view, ...callbacks, props, copy, source }
}
function fill(label: string, alias: string, copy: typeof en | typeof zh = en): void {
  fireEvent.change(screen.getByRole('textbox', { name: copy.label }), { target: { value: label } })
  fireEvent.change(screen.getByRole('textbox', { name: copy.sshAlias }), { target: { value: alias } })
}

describe('native execution host settings', () => {
  it('explains unavailable release payloads without submitting installation or exposing credentials', async () => {
    const b = bench()
    fireEvent.change(screen.getByRole('combobox', { name: en['runtime.target'] }), { target: { value: target.id } })
    for (const [key, value] of Object.entries({ host: 'remote.example', username: 'operator', privateKeyFile: 'C:/keys/reference',
      hostKeySHA256: 'a'.repeat(64), node: '/usr/bin/node', installRoot: '/opt/runtime', workspace: '/srv/work' })) {
      fireEvent.change(screen.getByRole('textbox', { name: en[('runtime.' + key) as keyof typeof en] }), { target: { value } })
    }
    b.detectRuntime.mockRejectedValueOnce({ code: 'execution-runtime/release-unavailable', message: 'Verified release unavailable' })
    fireEvent.click(screen.getByRole('button', { name: en['runtime.detect'] }))
    await screen.findByText(en['runtime.errorRelease'])
    expect(b.startRuntime).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: en['runtime.privateKeyFile'] }).getAttribute('value')).toBe('C:/keys/reference')
    expect(b.container.textContent).not.toContain('PRIVATE KEY')
  })

  it.each(['en', 'zh'] as const)('adds a saved alias without connecting in %s', async (language) => {
    const b = bench(language)
    fireEvent.click(screen.getByRole('button', { name: b.copy.add }))
    fill('Build host', 'build-config-alias', b.copy)
    fireEvent.click(screen.getByRole('button', { name: b.copy.save }))
    await screen.findByText(b.copy.saved)
    expect(b.create).toHaveBeenCalledWith({ label: 'Build host', sshAlias: 'build-config-alias' }, expect.any(AbortSignal))
    expect(b.connect).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('keeps process provenance separate from saved target identifiers and unavailable defaults', () => {
    const b = bench()
    const local = b.container.querySelector<HTMLElement>('[data-settings-anchor="current"]')!
    expect(within(local).getByText('local-process-17')).toBeTruthy()
    expect(within(local).queryByRole('button')).toBeNull()
    expect(screen.getByText('saved-target-3')).toBeTruthy()
    for (const id of ['default', 'confirmSwitch', 'isolation']) {
      const row = b.container.querySelector<HTMLElement>('[data-settings-anchor="' + id + '"]')!
      expect(within(row).getByText(en.routingUnavailable)).toBeTruthy()
      expect(within(row).getByText(en.unavailable)).toBeTruthy()
      expect(within(row).queryByRole('combobox')).toBeNull()
      expect(within(row).queryByRole('checkbox')).toBeNull()
      row.focus()
      expect(document.activeElement).toBe(row)
    }
    expect(screen.queryByText(/online|ping/i)).toBeNull()
  })

  it('keeps both draft inputs and the captured revision after a failed save', async () => {
    const b = bench()
    b.update.mockRejectedValueOnce(failure('execution-host/invalid-request', 'Alias is not configured'))
    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    fill('My draft', 'bad-alias')
    act(() => { b.source.set({ status: 'ready', value: { ...baseline, targets: [{ ...target, revision: 8 }] }, error: undefined }) })
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(await screen.findByText(en.errorInvalidRequest)).toBeTruthy()
    expect(screen.getByText('Alias is not configured')).toBeTruthy()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.label }).value).toBe('My draft')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.sshAlias }).value).toBe('bad-alias')
    expect(b.update).toHaveBeenCalledWith({ id: target.id, revision: 3, label: 'My draft', sshAlias: 'bad-alias' }, expect.any(AbortSignal))
  })

  it('refreshes a conflict and retries with the new revision without losing the draft', async () => {
    const b = bench()
    b.update.mockRejectedValueOnce(failure('execution-host/conflict'))
    b.refresh.mockResolvedValue({ ...baseline, targets: [{ ...target, revision: 9, label: 'Other editor', sshAlias: 'other-alias' }] })
    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    fill('My draft', 'my-alias')
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByText(en.errorConflict)
    await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: en.save }).disabled).toBe(false) })
    expect(b.refresh).toHaveBeenCalledOnce()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.label }).value).toBe('My draft')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.sshAlias }).value).toBe('my-alias')
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByText(en.saved)
    expect(b.update).toHaveBeenLastCalledWith({ id: target.id, revision: 9, label: 'My draft', sshAlias: 'my-alias' }, expect.any(AbortSignal))
  })

  it('preserves a draft when conflict recovery finds its target deleted', async () => {
    const b = bench()
    b.update.mockRejectedValue(failure('execution-host/conflict'))
    b.refresh.mockResolvedValue({ ...baseline, targets: [] })
    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    fill('Keep this', 'keep-alias')
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    await screen.findByText(en.errorNotFound)
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.label }).value).toBe('Keep this')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.save }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('requires confirmation to delete and retains the confirmation after a failed removal', async () => {
    const b = bench()
    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    expect(screen.getByRole('dialog', { name: en.deleteTitle })).toBeTruthy()
    expect(b.removeTarget).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    b.removeTarget.mockRejectedValueOnce(failure('execution-host/outcome-unconfirmed'))
    fireEvent.click(screen.getByRole('button', { name: en.deleteConfirm }))
    await screen.findByText(en.errorUnconfirmed)
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.deleteConfirm }))
    await screen.findByText(en.deleted)
    expect(b.removeTarget).toHaveBeenLastCalledWith({ id: target.id, revision: 3 }, expect.any(AbortSignal))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows connecting until a ready snapshot arrives and permits explicit disconnect', async () => {
    const b = bench()
    const connection = deferred<{ target: typeof target }>()
    b.connect.mockReturnValue(connection.promise)
    fireEvent.click(screen.getByRole('button', { name: en.connect }))
    expect(b.connect).toHaveBeenCalledWith({ id: target.id, revision: 3 }, expect.any(AbortSignal))
    act(() => { b.source.set({ status: 'ready', value: { ...baseline, targets: [{ ...target, state: { phase: 'connecting', generation: 4 } }] }, error: undefined }) })
    expect(screen.getByText(en.connecting)).toBeTruthy()
    expect(screen.queryByText(en.ready)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.disconnect }))
    await screen.findByText(en.disconnectedDone)
    expect(b.disconnect).toHaveBeenCalledWith({ id: target.id }, expect.any(AbortSignal))
    expect(b.connect.mock.calls[0]![1]?.aborted).toBe(true)
    await act(async () => { connection.resolve({ target: readyTarget }); await connection.promise })
    expect(screen.queryByText(en.ready)).toBeNull()
  })

  it.each(['en', 'zh'] as const)('inspects the selected exported root and relative path in %s', async (language) => {
    const b = bench(language, { ...baseline, targets: [readyTarget] })
    expect(screen.getByText(b.copy.ready)).toBeTruthy()
    expect(screen.getByText('remote-process-8')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: b.copy.root }), { target: { value: 'data' } })
    fireEvent.change(screen.getByRole('textbox', { name: b.copy.relativePath }), { target: { value: 'reports' } })
    fireEvent.click(screen.getByRole('button', { name: b.copy.inspect }))
    expect(await screen.findByText('main.ts')).toBeTruthy()
    expect(b.inspectDirectory).toHaveBeenCalledWith({ id: target.id, generation: 4, rootId: 'data', path: 'reports' }, expect.any(AbortSignal))
    expect(screen.getByText(b.copy.truncated)).toBeTruthy()
    const table = screen.getByRole('table')
    for (const label of [b.copy.file, b.copy.directory, b.copy.symlink, b.copy.other]) expect(within(table).getByText(label)).toBeTruthy()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: b.copy.relativePath }).value).toBe('reports')
  })

  it('retains the requested directory after inspection failure and clears stale results on reconnect', async () => {
    const b = bench('en', { ...baseline, targets: [readyTarget] })
    b.inspectDirectory.mockRejectedValueOnce(failure('execution-host/inspection-failed'))
    fireEvent.change(screen.getByRole('textbox', { name: en.relativePath }), { target: { value: '../outside' } })
    fireEvent.click(screen.getByRole('button', { name: en.inspect }))
    await screen.findByText(en.errorInspection)
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.relativePath }).value).toBe('../outside')
    fireEvent.change(screen.getByRole('textbox', { name: en.relativePath }), { target: { value: 'src' } })
    fireEvent.click(screen.getByRole('button', { name: en.inspect }))
    await screen.findByText('main.ts')
    act(() => { b.source.set({ status: 'ready', value: baseline, error: undefined }) })
    expect(screen.queryByText('main.ts')).toBeNull()
    act(() => { b.source.set({ status: 'ready', value: { ...baseline, targets: [readyTarget] }, error: undefined }) })
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.relativePath }).value).toBe('')
  })

  it('localizes typed target errors and disables stale ready actions after transport failure', () => {
    const b = bench('en', { ...baseline, targets: [{ ...target, state: { phase: 'error', generation: 4, code: 'roots-unconfigured', message: 'No exported roots' } }] })
    expect(screen.getByText(en.errorRoots)).toBeTruthy()
    act(() => { b.source.set({ status: 'error', value: { ...baseline, targets: [readyTarget] }, error: { code: 'execution-host/connection-lost', message: '' } }) })
    expect(screen.getByText(en.errorConnectionLost)).toBeTruthy()
    expect(screen.queryByText(en.ready)).toBeNull()
    expect(screen.queryByRole('combobox', { name: en.root })).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.disconnect }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.refresh }).disabled).toBe(false)
  })

  it('aborts an inspection on unmount and ignores its late result', async () => {
    const b = bench('en', { ...baseline, targets: [readyTarget] })
    const request = deferred<{ target: typeof target; inspection: typeof inspection }>()
    b.inspectDirectory.mockReturnValue(request.promise)
    fireEvent.click(screen.getByRole('button', { name: en.inspect }))
    const signal = b.inspectDirectory.mock.calls[0]![1]!
    b.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => { request.resolve({ target: readyTarget, inspection }); await request.promise })
    expect(screen.queryByText('main.ts')).toBeNull()
  })

  it('pins the unavailable routing copy and Chinese native search anchors', () => {
    const b = bench('zh')
    expect({
      title: screen.getByRole('heading', { level: 2 }).textContent,
      anchors: [...b.container.querySelectorAll('[data-settings-anchor]')].map(element => element.getAttribute('data-settings-anchor')),
      reason: [...b.container.querySelectorAll('[data-settings-anchor="default"] p')].map(element => element.textContent),
    }).toEqual({
      title: '执行主机', anchors: ['current', 'hosts', 'ssh-alias', 'runtime', 'inspection', 'default', 'confirmSwitch', 'isolation'],
      reason: ['选择新会话的执行位置。', '创建工作区时选择执行 Host。会话保留此绑定；全局默认设置和运行中切换不可用。'],
    })
  })
})
