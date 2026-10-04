// @vitest-environment jsdom
/** SSH host page behavior through typed callbacks and the renderer's observable binding. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ListTargetsValue } from '@deepseek-ai/dsh-api-execution-host-controller/types'
import { HostsSection } from '../src/client/HostsSection.tsx'
import type { HostsProps, HostsSnapshot } from '../src/client/types.ts'
import { en, zh } from '../src/client/locales.ts'
import { baseline, connectionTarget, deferred, failure, importable, readyTarget, target } from './fixtures.client.ts'
import type {} from '../src/client/index.ts'

afterEach(cleanup)
type Copy = typeof en | typeof zh
function bench(language: 'en' | 'zh' = 'en', value: ListTargetsValue = baseline) {
  const copy = language === 'en' ? en : zh
  const source = createSnapshotStore<HostsSnapshot>({ status: 'ready', value, error: undefined })
  const callbacks = {
    refresh: vi.fn<HostsProps['refresh']>(async () => value),
    create: vi.fn<HostsProps['create']>(async () => ({ target })),
    update: vi.fn<HostsProps['update']>(async () => ({ target })),
    removeTarget: vi.fn<HostsProps['removeTarget']>(async () => ({})),
    connect: vi.fn<HostsProps['connect']>(async () => ({ target: readyTarget })),
    disconnect: vi.fn<HostsProps['disconnect']>(async () => ({ target })),
    test: vi.fn<HostsProps['test']>(async () => ({ target, rootCount: 2 })),
    listImportableHosts: vi.fn<HostsProps['listImportableHosts']>(async () => importable),
  }
  // This section consumes no session or workspace standard seats.
  const props = { ...callbacks, useHosts: bindSnapshotSelector(source), t: makeTranslate(copy) } as HostsProps
  const view = render(<HostsSection {...props} />)
  return { ...view, ...callbacks, props, copy, source }
}
/** The page header and the dialog both name their primary action, so dialogs are scoped by title. */
function openCreate(copy: Copy = en): void {
  fireEvent.click(screen.getByRole('button', { name: copy.add }))
}
function submitCreate(copy: Copy = en): void {
  fireEvent.click(within(screen.getByRole('dialog', { name: copy.createTitle })).getByRole('button', { name: copy.formCreate }))
}
function submitSave(copy: Copy = en): void {
  fireEvent.click(within(screen.getByRole('dialog', { name: copy.editTitle })).getByRole('button', { name: copy.formSave }))
}
function createButton(copy: Copy = en): HTMLButtonElement {
  return within(screen.getByRole('dialog', { name: copy.createTitle })).getByRole<HTMLButtonElement>('button', { name: copy.formCreate })
}
function saveButton(copy: Copy = en): HTMLButtonElement {
  return within(screen.getByRole('dialog', { name: copy.editTitle })).getByRole<HTMLButtonElement>('button', { name: copy.formSave })
}
function fill(label: string, destination: string, copy: Copy = en): void {
  fireEvent.change(screen.getByRole('textbox', { name: copy.formLabel }), { target: { value: label } })
  fireEvent.change(screen.getByRole('textbox', { name: copy.formDestination }), { target: { value: destination } })
}
function revealAdvanced(copy: Copy = en): void {
  fireEvent.click(screen.getByRole('button', { name: copy.formAdvanced }))
}

describe('execution host settings page', () => {
  it.each(['en', 'zh'] as const)('saves a target from the single destination field in %s', async (language) => {
    const b = bench(language)
    openCreate(b.copy)
    fill('Build host', 'build-config-alias', b.copy)
    submitCreate(b.copy)
    await screen.findByText(b.copy.saved)
    expect(b.create).toHaveBeenCalledWith({
      label: 'Build host', sshAlias: 'build-config-alias', connection: { port: 22 },
    }, expect.any(AbortSignal))
    expect(b.connect).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('splits the single destination field into the saved alias and its refinements', async () => {
    const b = bench()
    openCreate()
    fill('Build host', 'deploy@build.example:2222')
    submitCreate()
    await screen.findByText(en.saved)
    expect(b.create).toHaveBeenCalledWith({
      label: 'Build host', sshAlias: 'build.example', connection: { port: 2222, username: 'deploy' },
    }, expect.any(AbortSignal))
  })

  it('submits the advanced fields and keeps them folded until the operator asks for them', async () => {
    const b = bench()
    openCreate()
    fill('Tunneled', 'tunneled-host')
    expect(screen.queryByRole('textbox', { name: en.formProxyCommand })).toBeNull()
    revealAdvanced()
    fireEvent.change(screen.getByRole('textbox', { name: en.formUsername }), { target: { value: 'deploy' } })
    fireEvent.change(screen.getByRole('textbox', { name: en.formProxyCommand }), { target: { value: 'cloudflared access ssh --hostname %h' } })
    fireEvent.change(screen.getByRole('textbox', { name: en.formJumpHost }), { target: { value: 'bastion.example.com' } })
    fireEvent.click(screen.getByRole('switch', { name: en.formConnectionReuse }))
    fireEvent.change(screen.getByRole('spinbutton', { name: en.formConnectTimeout }), { target: { value: '600' } })
    submitCreate()
    await screen.findByText(en.saved)
    expect(b.create).toHaveBeenCalledWith({
      label: 'Tunneled', sshAlias: 'tunneled-host',
      connection: {
        port: 22, username: 'deploy', proxyCommand: 'cloudflared access ssh --hostname %h',
        jumpHost: 'bastion.example.com', multiplex: false, connectTimeoutSeconds: 600,
      },
    }, expect.any(AbortSignal))
  })

  it('records a connection deadline only when the operator states one', async () => {
    const b = bench()
    openCreate()
    fill('Deadline', 'deadline-host')
    revealAdvanced()
    const field = screen.getByRole('spinbutton', { name: en.formConnectTimeout }) as HTMLInputElement
    expect(field.disabled).toBe(false)
    expect(field.value).toBe('')
    fireEvent.change(field, { target: { value: '0' } })
    submitCreate()
    expect(await screen.findByText(en.formInvalidTimeout)).toBeTruthy()
    fireEvent.change(field, { target: { value: '604801' } })
    submitCreate()
    expect(await screen.findByText(en.formInvalidTimeout)).toBeTruthy()
    expect(b.create).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: '600' } })
    submitCreate()
    await screen.findByText(en.saved)
    expect(b.create).toHaveBeenLastCalledWith({
      label: 'Deadline', sshAlias: 'deadline-host', connection: { port: 22, connectTimeoutSeconds: 600 },
    }, expect.any(AbortSignal))
  })

  it('round-trips a saved connection deadline through the editor', async () => {
    const b = bench('en', { ...baseline, targets: [connectionTarget] })
    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    revealAdvanced()
    expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: en.formConnectTimeout }).value).toBe('3600')
    submitSave()
    await screen.findByText(en.saved)
    expect(b.update).toHaveBeenCalledWith({
      id: connectionTarget.id, revision: connectionTarget.revision,
      label: connectionTarget.label, sshAlias: connectionTarget.sshAlias,
      connection: {
        port: 2222, username: 'deploy', privateKeyFile: '~/.ssh/id_ed25519',
        multiplex: false, connectTimeoutSeconds: 3600,
      },
    }, expect.any(AbortSignal))
  })

  it('rejects a destination that is not one OpenSSH alias and a port outside the accepted range', async () => {
    const b = bench()
    openCreate()
    fill('Bad', 'good;uname')
    submitCreate()
    expect(await screen.findByText(en.formInvalidDestinationFormat)).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: en.formDestination }), { target: { value: 'good-host' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: en.formPort }), { target: { value: '70000' } })
    submitCreate()
    expect(await screen.findByText(en.formInvalidPort)).toBeTruthy()
    fireEvent.change(screen.getByRole('spinbutton', { name: en.formPort }), { target: { value: '2222' } })
    submitCreate()
    await screen.findByText(en.saved)
    expect(b.create).toHaveBeenLastCalledWith({
      label: 'Bad', sshAlias: 'good-host', connection: { port: 2222 },
    }, expect.any(AbortSignal))
  })

  it('refuses an empty destination', async () => {
    const b = bench()
    openCreate()
    expect(createButton().disabled).toBe(false)
    submitCreate()
    expect(await screen.findByText(en.formInvalidDestination)).toBeTruthy()
    expect(b.create).not.toHaveBeenCalled()
  })

  it('shows the account, alias, identity file and connection deadline on the target card', () => {
    bench('en', { ...baseline, targets: [connectionTarget] })
    expect(screen.getByText('deploy@build-host:2222 • ~/.ssh/id_ed25519 • connect timeout: 3600s')).toBeTruthy()
    expect(screen.getByText(en.disconnected)).toBeTruthy()
  })

  it('leaves the card without a deadline segment while the target keeps the plugin default', () => {
    bench('en', { ...baseline, targets: [target] })
    expect(screen.getByText('dev-server')).toBeTruthy()
  })

  it('tests a saved target without connecting and reports the probed roots', async () => {
    const b = bench()
    fireEvent.click(screen.getByRole('button', { name: en.test }))
    await screen.findByText('Reachable · exported roots: 2')
    expect(b.test).toHaveBeenCalledWith({ id: target.id, revision: 3 }, expect.any(AbortSignal))
    expect(b.connect).not.toHaveBeenCalled()
  })

  it('replaces the running worker through the card relay action', async () => {
    const b = bench('en', { ...baseline, targets: [readyTarget] })
    const reconnect = deferred<{ target: typeof target }>()
    b.connect.mockReturnValue(reconnect.promise)
    fireEvent.click(screen.getByRole('button', { name: en.resetRelay }))
    expect(b.connect).toHaveBeenCalledWith({ id: target.id, revision: 3 }, expect.any(AbortSignal))
    // A fresh incarnation is admitted under the connecting state, so the relay
    // action withdraws until the replacement settles.
    act(() => { b.source.set({ status: 'ready', value: { ...baseline, targets: [{ ...readyTarget, state: { phase: 'connecting', generation: 5 } }] }, error: undefined }) })
    expect(screen.queryByRole('button', { name: en.resetRelay })).toBeNull()
    // The follow stream republishes the replacement incarnation as ready.
    act(() => { b.source.set({ status: 'ready', value: { ...baseline, targets: [readyTarget] }, error: undefined }) })
    await act(async () => { reconnect.resolve({ target: readyTarget }); await reconnect.promise })
    await screen.findByText(en.resetDone)
    expect(screen.getByRole('button', { name: en.resetRelay })).toBeTruthy()
  })

  it('hides the relay action while a target has no live worker', () => {
    bench('en', { ...baseline, targets: [target] })
    expect(screen.queryByRole('button', { name: en.resetRelay })).toBeNull()
    expect(screen.getByRole('button', { name: en.connect })).toBeTruthy()
  })

  it('renders the typed failure reason on the card when a probe cannot reach the target', async () => {
    const b = bench()
    b.test.mockRejectedValueOnce(failure('execution-host/unreachable'))
    fireEvent.click(screen.getByRole('button', { name: en.test }))
    expect(await screen.findByText(en.errorUnreachable)).toBeTruthy()
  })

  it('imports one OpenSSH Host entry and prefills the form for confirmation', async () => {
    const b = bench('zh')
    fireEvent.click(screen.getByRole('button', { name: zh.import }))
    expect(await screen.findByText('读取自 C:/Users/operator/.ssh/config')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.importEntry.replace('{alias}', 'build-host') }))
    expect(screen.queryByRole('dialog', { name: zh.importTitle })).toBeNull()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: zh.formLabel }).value).toBe('build-host')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: zh.formDestination }).value).toBe('build-host')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: zh.formUsername }).value).toBe('deploy')
    expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: zh.formPort }).value).toBe('2222')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: zh.formIdentityFile }).value).toBe('~/.ssh/id_ed25519')
    fireEvent.click(screen.getByRole('button', { name: zh.formAdvanced }))
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: zh.formProxyCommand }).value).toBe('cloudflared access ssh --hostname %h')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: zh.formJumpHost }).value).toBe('bastion.example.com')
    // Saving stays a separate, explicit confirmation.
    expect(b.create).not.toHaveBeenCalled()
  })

  it('reports a missing or unreadable OpenSSH configuration without failing the page', async () => {
    const b = bench()
    b.listImportableHosts.mockResolvedValueOnce({ source: 'C:/Users/operator/.ssh/config', exists: false, entries: [] })
    fireEvent.click(screen.getByRole('button', { name: en.import }))
    expect(await screen.findByText('No OpenSSH configuration was found at C:/Users/operator/.ssh/config.')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog', { name: en.importTitle })).getAllByRole('button', { name: en.close })[0]!)
    b.listImportableHosts.mockRejectedValueOnce(failure('execution-host/configuration-unreadable'))
    fireEvent.click(screen.getByRole('button', { name: en.import }))
    expect(await screen.findByText(en.errorConfigurationUnreadable)).toBeTruthy()
  })

  it('keeps the draft and the captured revision after a failed save', async () => {
    const b = bench()
    b.update.mockRejectedValueOnce(failure('execution-host/invalid-request', 'Alias is not configured'))
    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    fill('My draft', 'bad-alias')
    act(() => { b.source.set({ status: 'ready', value: { ...baseline, targets: [{ ...target, revision: 8 }] }, error: undefined }) })
    submitSave()
    expect(await screen.findByText(en.errorInvalidRequest)).toBeTruthy()
    expect(screen.getByText('Alias is not configured')).toBeTruthy()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.formLabel }).value).toBe('My draft')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.formDestination }).value).toBe('bad-alias')
    expect(b.update).toHaveBeenCalledWith({
      id: target.id, revision: 3, label: 'My draft', sshAlias: 'bad-alias', connection: { port: 22 },
    }, expect.any(AbortSignal))
  })

  it('refreshes a conflict and retries with the new revision without losing the draft', async () => {
    const b = bench()
    b.update.mockRejectedValueOnce(failure('execution-host/conflict'))
    b.refresh.mockResolvedValue({ ...baseline, targets: [{ ...target, revision: 9, label: 'Other editor', sshAlias: 'other-alias' }] })
    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    fill('My draft', 'my-alias')
    submitSave()
    await screen.findByText(en.errorConflict)
    await waitFor(() => { expect(saveButton().disabled).toBe(false) })
    expect(b.refresh).toHaveBeenCalledOnce()
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.formLabel }).value).toBe('My draft')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.formDestination }).value).toBe('my-alias')
    submitSave()
    await screen.findByText(en.saved)
    expect(b.update).toHaveBeenLastCalledWith({
      id: target.id, revision: 9, label: 'My draft', sshAlias: 'my-alias', connection: { port: 22 },
    }, expect.any(AbortSignal))
  })

  it('preserves a draft when conflict recovery finds its target deleted', async () => {
    const b = bench()
    b.update.mockRejectedValue(failure('execution-host/conflict'))
    b.refresh.mockResolvedValue({ ...baseline, targets: [] })
    fireEvent.click(screen.getByRole('button', { name: en.edit }))
    fill('Keep this', 'keep-alias')
    submitSave()
    await screen.findByText(en.errorNotFound)
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.formLabel }).value).toBe('Keep this')
    expect(saveButton().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.formCancel }))
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('requires confirmation to delete and retains the confirmation after a failed removal', async () => {
    const b = bench()
    fireEvent.click(screen.getByRole('button', { name: en.remove }))
    expect(screen.getByRole('dialog', { name: en.deleteTitle })).toBeTruthy()
    expect(b.removeTarget).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.formCancel }))
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

  it('localizes typed target errors and disables stale ready actions after transport failure', () => {
    const b = bench('en', { ...baseline, targets: [{ ...target, state: { phase: 'error', generation: 4, code: 'roots-unconfigured', message: 'No exported roots' } }] })
    expect(screen.getByText(en.errorRoots, { exact: false })).toBeTruthy()
    act(() => { b.source.set({ status: 'error', value: { ...baseline, targets: [readyTarget] }, error: { code: 'execution-host/connection-lost', message: '' } }) })
    expect(screen.getByText(en.errorConnectionLost)).toBeTruthy()
    expect(screen.queryByText(en.ready)).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.edit }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.remove }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.disconnect }).disabled).toBe(true)
  })

  it('shows the empty state and pins the routing copy in Chinese', () => {
    const b = bench('zh', { current: baseline.current, targets: [] })
    expect({
      title: b.container.querySelector('h1')?.textContent,
      lead: b.container.querySelector('p')?.textContent,
      anchors: [...b.container.querySelectorAll('[data-settings-anchor]')].map(element => element.getAttribute('data-settings-anchor')),
      sections: [...b.container.querySelectorAll('h3')].map(element => element.textContent),
    }).toEqual({
      title: 'SSH 远程主机',
      lead: '通过 SSH 使用已有机器处理文件、终端、Git 和工作区。',
      anchors: ['hosts', 'ssh-alias'],
      sections: ['目标'],
    })
    expect(screen.getByText(zh.empty)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: zh.add })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: zh.import })).toHaveLength(1)
    expect(b.container.textContent).toContain('通过 SSH 使用已有机器处理文件、终端、Git 和工作区。')
  })
})