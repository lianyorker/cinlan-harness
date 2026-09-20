// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { PluginManagerController } from '../src/client/manager-store.ts'
import { PluginManagerTab, type PluginManagerTabProps } from '../src/client/PluginManagerTab.tsx'
import { en, zh, type PluginManagerLocaleKey } from '../src/client/locales.ts'
import type { ConfigLedger } from '../src/client/config-ledger.ts'

afterEach(cleanup)

const translate = (dict: typeof en): PluginManagerTabProps['t'] => ((key: PluginManagerLocaleKey, params?: Record<string, string>) =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll('{' + name + '}', value), dict[key])) as PluginManagerTabProps['t']
const ok = <T,>(value: T) => ({ ok: true as const, value })
const applied = { changed: true, application: 'applied', stage: 'enable', target: 'dsh-example' } as const
const bundle = { name: 'dsh-example', enabled: true, installed: true, optional: false, removable: true,
  rows: [{ rowId: 'worker', moduleName: 'example-worker', entryId: 'include:worker' }], overrides: [] }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

function bench(available = true, locale: typeof en = en, options: {
  desktop?: { readonly openPlugins?: () => Promise<void> }
  packageManagement?: 'desktop'
} = {}) {
  const inventory = { list: vi.fn().mockResolvedValue(ok({
    entries: [], managementAvailable: available,
    ...options.packageManagement === undefined ? {} : { packageManagement: options.packageManagement },
  })) }
  const manager = {
    listBundles: vi.fn().mockResolvedValue(ok([bundle])),
    listPlugins: vi.fn().mockResolvedValue(ok([{ entryId: 'include:worker', moduleName: 'example-worker', enabled: true, fiberPhase: 'active', patchId: 'worker' }])),
    setBundleEnabled: vi.fn().mockResolvedValue(ok(applied)), setPluginEnabled: vi.fn().mockResolvedValue(ok(applied)),
    removeBundle: vi.fn().mockResolvedValue(ok(applied)),
    inspect: vi.fn().mockResolvedValue(ok({ status: 'accepted', kind: 'registry', name: 'dsh-new', bundle: true })),
    installBundle: vi.fn().mockResolvedValue(ok({ ...applied, bundle: 'dsh-new' })),
    cancelInstall: vi.fn().mockResolvedValue(ok({ status: 'cancelled' })),
  }
  const controller = new PluginManagerController({ get: (name: string) => name === 'remote.pluginInventory' ? inventory : manager } as never, options.desktop)
  const ledger = createSnapshotStore<ConfigLedger>({ items: [], bundles: new Set(), rows: new Set() })
  const face = controller.inject(ledger)
  const renderSlot = vi.fn(() => null)
  const props = { ...face, t: translate(locale), usePluginManager: bindSnapshotSelector(face.hooks.pluginManager),
    useConfigLedger: bindSnapshotSelector(ledger), renderSlot } as unknown as PluginManagerTabProps
  const mounted = render(<PluginManagerTab {...props} />)
  return { inventory, manager, controller, ledger, face, renderSlot, mounted, props }
}

async function openInstall() {
  fireEvent.click(await screen.findByRole('button', { name: en.addPlugin }))
  fireEvent.change(screen.getByRole('textbox', { name: en.installSpecLabel }), { target: { value: 'dsh-new' } })
  fireEvent.click(screen.getByRole('button', { name: en.installRun }))
}

describe('Settings management controls', () => {
  it('delegates Desktop Add to its native window and retains row controls and feature settings', async () => {
    const openPlugins = vi.fn(async () => {})
    const b = bench(true, en, { desktop: { openPlugins }, packageManagement: 'desktop' })
    await screen.findByRole('button', { name: 'View example' })
    fireEvent.click(screen.getByRole('button', { name: en.addPlugin }))
    expect(openPlugins).toHaveBeenCalledExactlyOnceWith()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(b.controller.getSnapshot().install).toMatchObject({ open: false, phase: 'idle', installed: null })
    expect(screen.getByRole('switch', { name: 'Enable example' })).toHaveProperty('disabled', true)
    act(() => { b.ledger.set({ items: [{ id: 'official', label: 'Official config' }], bundles: new Set([bundle.name]), rows: new Set(['dsh-example#worker']) }) })
    fireEvent.click(screen.getByRole('button', { name: 'View example' }))
    expect(screen.queryByRole('button', { name: 'Uninstall example' })).toBeNull()
    expect(b.renderSlot).toHaveBeenCalledWith('plugins.item', { view: 'page' }, { only: 'official' })
    expect(b.renderSlot).toHaveBeenCalledWith('plugins.bundle.config', { view: 'page' }, { entryKey: bundle.name })
    expect(b.renderSlot).toHaveBeenCalledWith('plugins.row.config', { view: 'page' }, { entryKey: 'dsh-example#worker' })
    fireEvent.click(screen.getByRole('switch', { name: 'Enable component worker' }))
    expect(b.manager.setPluginEnabled).toHaveBeenCalledWith('include:worker', false)
    await act(async () => { await b.controller.load() })
    act(() => {
      b.face.editInstallSpec('dsh-new')
      b.face.runInstall()
      b.face.setEnabled(bundle.name, false)
      b.face.uninstall(bundle.name)
      b.face.confirm()
    })
    expect(b.manager.inspect).not.toHaveBeenCalled()
    expect(b.manager.installBundle).not.toHaveBeenCalled()
    expect(b.manager.setBundleEnabled).not.toHaveBeenCalled()
    expect(b.manager.removeBundle).not.toHaveBeenCalled()
    b.controller.dispose()
  })

  it.each([en, zh])('shows localized shell installation guidance when the opener is absent', async (dict) => {
    const b = bench(true, dict, { packageManagement: 'desktop' })
    fireEvent.click(await screen.findByRole('button', { name: dict.addPlugin }))
    expect(screen.getByRole('status').textContent).toMatchSnapshot()
    expect(within(screen.getByRole('status')).getByText(dict.desktopPackages)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(b.manager.inspect).not.toHaveBeenCalled()
    expect(b.manager.installBundle).not.toHaveBeenCalled()
    b.controller.dispose()
  })

  it.each([en, zh])('reports native window failures without starting Host installation', async (dict) => {
    const b = bench(true, dict, { desktop: { openPlugins: vi.fn().mockRejectedValue(new Error('window unavailable')) } })
    await screen.findByRole('button', { name: dict.openDetail.replace('{name}', 'example') })
    fireEvent.click(screen.getByRole('button', { name: dict.addPlugin }))
    expect((await screen.findByRole('alert')).textContent).toMatchSnapshot()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(b.manager.inspect).not.toHaveBeenCalled()
    expect(b.manager.installBundle).not.toHaveBeenCalled()
    b.controller.dispose()
  })

  it('opens native package management when live profile controls are unavailable', async () => {
    const openPlugins = vi.fn(async () => {})
    const b = bench(false, en, { desktop: { openPlugins } })
    await screen.findByText(en.unavailable)
    fireEvent.click(screen.getByRole('button', { name: en.addPlugin }))
    expect(openPlugins).toHaveBeenCalledExactlyOnceWith()
    expect(b.manager.listBundles).not.toHaveBeenCalled()
    expect(b.manager.inspect).not.toHaveBeenCalled()
    expect(b.manager.installBundle).not.toHaveBeenCalled()
    b.controller.dispose()
  })

  it.each([en, zh])('localizes unavailable management and offers no mutators', async (dict) => {
    const b = bench(false, dict)
    expect(await screen.findByText(dict.unavailable)).toBeTruthy()
    expect(screen.queryByRole('button', { name: dict.addPlugin })).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(b.manager.listBundles).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toMatchSnapshot()
    b.controller.dispose()
  })

  it('keeps pending switches unchanged and reports refusals, then refreshes the Host state', async () => {
    const b = bench()
    const control = await screen.findByRole('switch', { name: 'Enable example' })
    const pending = deferred<ReturnType<typeof ok>>()
    b.manager.setBundleEnabled.mockReturnValueOnce(pending.promise)
    fireEvent.click(control)
    expect(control).toHaveProperty('disabled', true)
    expect(control.getAttribute('aria-checked')).toBe('true')
    await act(async () => { pending.resolve(ok({ ...applied, application: 'failed', error: { code: 'operation-error', diagnostic: 'file conflict' } })) })
    expect(within(await screen.findByRole('alert')).getByText('Could not disable: file conflict')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'View example' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Enable component worker' }))
    expect(b.manager.setPluginEnabled).toHaveBeenCalledWith('include:worker', false)
    await act(async () => { await b.controller.load() })
    b.manager.listBundles.mockResolvedValue(ok([{ ...bundle, enabled: false }]))
    fireEvent.click(control)
    await vi.waitFor(() => { expect(control.getAttribute('aria-checked')).toBe('false') })
    b.controller.dispose()
  })

  it('uninstalls only after confirmation and preserves Host failures', async () => {
    const b = bench()
    fireEvent.click(await screen.findByRole('button', { name: 'View example' }))
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall example' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.cancel }))
    expect(b.manager.removeBundle).not.toHaveBeenCalled()
    b.manager.removeBundle.mockResolvedValue(ok({ ...applied, application: 'failed', error: { code: 'bundle-in-use' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall example' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: en.confirmUninstall }))
    expect(within(await screen.findByRole('alert')).getByText('Could not uninstall: ' + en.reasonBundleInUse)).toBeTruthy()
    expect(b.manager.removeBundle).toHaveBeenCalledExactlyOnceWith(bundle.name)
    b.controller.dispose()
  })

  it('renders each configuration through its own slot without inventing a save action', async () => {
    const b = bench()
    await screen.findByRole('button', { name: 'View example' })
    act(() => { b.ledger.set({ items: [{ id: 'official', label: 'Official config' }], bundles: new Set([bundle.name]), rows: new Set(['dsh-example#worker']) }) })
    fireEvent.click(screen.getByRole('button', { name: 'View example' }))
    expect(b.renderSlot).toHaveBeenCalledWith('plugins.item', { view: 'page' }, { only: 'official' })
    expect(b.renderSlot).toHaveBeenCalledWith('plugins.bundle.config', { view: 'page' }, { entryKey: bundle.name })
    expect(b.renderSlot).toHaveBeenCalledWith('plugins.row.config', { view: 'page' }, { entryKey: 'dsh-example#worker' })
    b.controller.dispose()
  })

  it('installs disabled and requires a second explicit approval before allowing build scripts', async () => {
    const b = bench()
    b.manager.installBundle.mockResolvedValueOnce(ok({ ...applied, application: 'failed', pendingBuilds: ['native-addon'],
      packageResult: { exitCode: 1, kind: 'build-blocked', output: 'blocked', logPath: '/log', truncated: false } }))
    await openInstall()
    fireEvent.click(await screen.findByRole('button', { name: en.installApproveAndRetry }))
    const approval = screen.getByRole('dialog', { name: en.installApprovalTitle })
    expect(within(approval).getByText('native-addon')).toBeTruthy()
    fireEvent.click(within(approval).getByRole('button', { name: en.cancel }))
    expect(b.manager.installBundle).toHaveBeenCalledTimes(1)
    expect(b.manager.installBundle.mock.calls[0]?.[1]).not.toHaveProperty('approvedBuilds')
    fireEvent.click(screen.getByRole('button', { name: en.installApproveAndRetry }))
    fireEvent.click(within(screen.getByRole('dialog', { name: en.installApprovalTitle })).getByRole('button', { name: en.installApproveAndRetry }))
    await screen.findByRole('dialog', { name: en.installedTitle })
    expect(b.manager.installBundle.mock.calls[1]?.[1]).toMatchObject({ enabled: false, approvedBuilds: ['native-addon'] })
    expect(b.manager.setBundleEnabled).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.installEnableNow }))
    await vi.waitFor(() => { expect(b.manager.setBundleEnabled).toHaveBeenCalledWith('dsh-new', true) })
    b.controller.dispose()
  })

  it('waits for confirmed cancellation and never converts a refused stop into success', async () => {
    const b = bench()
    const pending = deferred<ReturnType<typeof ok>>()
    b.manager.installBundle.mockReturnValueOnce(pending.promise)
    b.manager.cancelInstall.mockResolvedValueOnce(ok({ status: 'not-running' }))
    await openInstall()
    await vi.waitFor(() => { expect(b.controller.getSnapshot().install.phase).toBe('starting') })
    act(() => { b.controller.installProgress({ requestId: b.controller.getSnapshot().install.requestId!, phase: 'installing' }) })
    fireEvent.click(screen.getByRole('button', { name: en.installCancel }))
    fireEvent.click(within(screen.getByRole('dialog', { name: en.cancelInstallTitle })).getByRole('button', { name: en.cancel }))
    expect(b.manager.cancelInstall).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.installCancel }))
    fireEvent.click(within(screen.getByRole('dialog', { name: en.cancelInstallTitle })).getByRole('button', { name: en.installCancel }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', en.installCancelUnconfirmed.replace('{reason}', ''))
    expect(screen.getByRole('dialog', { name: en.installingTitle })).toBeTruthy()
    await act(async () => { pending.resolve(ok({ ...applied, application: 'failed', error: { code: 'operation-error', diagnostic: 'connection lost' } })) })
    expect(screen.getByRole('dialog', { name: en.installFailedTitle })).toBeTruthy()
    b.controller.dispose()
  })
})
