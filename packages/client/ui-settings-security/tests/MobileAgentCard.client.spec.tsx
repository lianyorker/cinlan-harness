// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { PluginEntryId, PluginInfo, ReadOnlyReason } from '@deepseek-ai/dsh-api-remotes/client'
import type { ProviderInventory } from '../src/client/capability-shared.ts'
import { MobileAgentCard } from '../src/client/MobileAgentCard.tsx'
import { en } from '../src/client/locales.ts'

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
afterEach(() => {
  cleanup()
  if (clipboardDescriptor === undefined) Reflect.deleteProperty(navigator, 'clipboard')
  else Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
})
const settle = async (): Promise<void> => { await new Promise((resolve) => { setTimeout(resolve, 0) }) }
const t = makeTranslate(en, commonEn)
const PROVIDER = '@deepseek-ai/dsh-mobile-device-adb'
const TOOLS = '@deepseek-ai/dsh-tool-mobile-device'
const entry = (moduleName: string, enabled = true, fiberPhase: PluginInfo['fiberPhase'] = 'active'): PluginInfo => ({
  entryId: ('row:' + moduleName) as PluginEntryId, moduleName, enabled, fiberPhase, patchId: moduleName,
})
const readOnlyEntry = (moduleName: string, readOnlyReason: ReadOnlyReason): PluginInfo => ({
  entryId: ('row:' + moduleName) as PluginEntryId, moduleName, enabled: true, fiberPhase: 'active', readOnlyReason,
})
const base = {
  listProviderEntries: async () => ({ kind: 'ready' as const, entries: [] }),
  setProviderEnabled: vi.fn(async () => ({ kind: 'result' as const, result: {
    changed: true, application: 'applied' as const, stage: 'enable' as const, target: 'x' as PluginEntryId } })),
  onChanged: vi.fn(), revision: 1, t,
}

describe('mobile agent card', () => {
  it('renders the two-step progress card and reports a loading inventory', async () => {
    const pending = Promise.withResolvers<ProviderInventory>()
    render(<MobileAgentCard {...base} listProviderEntries={() => pending.promise} />)
    expect(screen.getByText('0/2')).toBeTruthy()
    expect(screen.getByText(en.providerLoading)).toBeTruthy()
    pending.resolve({ kind: 'ready', entries: [] })
    expect((await screen.findAllByText(en.mobileAgentStepUnavailable)).length).toBe(2)
    expect(screen.getAllByText(en.mobileAgentStepPending).length).toBe(2)
  })

  it('counts both ready entries and toggles them through the exact entry ids', async () => {
    const setProviderEnabled = vi.fn(base.setProviderEnabled)
    render(<MobileAgentCard {...base} setProviderEnabled={setProviderEnabled}
      listProviderEntries={async () => ({ kind: 'ready', entries: [entry(PROVIDER), entry(TOOLS)] })} />)
    expect(await screen.findByText('2/2')).toBeTruthy()
    expect(screen.getByText(new RegExp(en.mobileAgentStepProvider))).toBeTruthy()
    expect(screen.getByText(new RegExp(en.mobileAgentStepTools))).toBeTruthy()
    expect(screen.getByText(en.mobileLaunchCommand)).toBeTruthy()
    expect(screen.getByText('mobile_observe')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: en.mobileAgentDisable })[0]!)
    await waitFor(() => { expect(setProviderEnabled).toHaveBeenCalledWith('row:' + PROVIDER, false) })
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentRecheck }))
    expect(base.onChanged).toHaveBeenCalled()
  })

  it('offers enable and install for disabled entries and shows their phases', async () => {
    render(<MobileAgentCard {...base} listProviderEntries={async () => ({ kind: 'ready', entries: [
      entry(PROVIDER, false, null), entry(TOOLS, true, 'failed'),
    ] })} />)
    expect(await screen.findByText(en.mobileAgentStepDisabled)).toBeTruthy()
    expect(screen.getByText(en.mobileAgentStepFailed)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentEnable }))
    await waitFor(() => { expect(base.setProviderEnabled).toHaveBeenCalledWith('row:' + PROVIDER, true) })
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentDisable }))
    await waitFor(() => { expect(base.setProviderEnabled).toHaveBeenLastCalledWith('row:' + TOOLS, false) })
  })

  it('marks an entry with no runtime phase as pending and offers installation', async () => {
    const view = render(<MobileAgentCard {...base} listProviderEntries={async () => ({ kind: 'ready', entries: [
      entry(TOOLS, true, null), entry(PROVIDER, false, 'active'),
    ] })} />)
    expect(await screen.findByText(en.mobileAgentStepPending)).toBeTruthy()
    expect(screen.getByText(en.mobileAgentStepDisabled)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentEnable }))
    await waitFor(() => { expect(base.setProviderEnabled).toHaveBeenCalledWith('row:' + PROVIDER, true) })
    view.rerender(<MobileAgentCard {...base} listProviderEntries={async () => ({ kind: 'ready', entries: [
      entry(TOOLS, false, 'active'), entry(PROVIDER, true, 'active'),
    ] })} revision={2} />)
    fireEvent.click(await screen.findByRole('button', { name: en.mobileAgentInstall }))
    await waitFor(() => { expect(base.setProviderEnabled).toHaveBeenLastCalledWith('row:' + TOOLS, true) })
  })

  it('keeps read-only rows non-actionable and reports inventory failures', async () => {
    const view = render(<MobileAgentCard {...base} listProviderEntries={async () => ({ kind: 'ready', entries: [
      readOnlyEntry(PROVIDER, 'unaddressable'),
    ] })} />)
    expect(await screen.findByText(en.providerManagedByProfile)).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.mobileAgentDisable })).toBeNull()
    view.rerender(<MobileAgentCard {...base} listProviderEntries={async () => ({ kind: 'unavailable' })} revision={2} />)
    expect(await screen.findByText(en.providerManagementUnavailable)).toBeTruthy()
    view.rerender(<MobileAgentCard {...base} listProviderEntries={async () => ({ kind: 'rejected' })} revision={3} />)
    expect((await screen.findByRole('alert')).textContent).toContain(en.providerRejected)
    view.rerender(<MobileAgentCard {...base} listProviderEntries={async () => { throw new Error('offline') }} revision={4} />)
    expect((await screen.findByRole('alert')).textContent).toContain(en.providerRejected)
  })

  it.each(['applied', 'restart-required', 'overridden', 'failed', 'cancelled'] as const)('reports the %s application outcome', async (application) => {
    render(<MobileAgentCard {...base} listProviderEntries={async () => ({ kind: 'ready', entries: [entry(PROVIDER)] })}
      setProviderEnabled={async () => ({ kind: 'result', result: {
        changed: application === 'applied', application, stage: 'enable', target: 'x' as PluginEntryId } })} />)
    fireEvent.click(await screen.findByRole('button', { name: en.mobileAgentDisable }))
    const text = { applied: en.providerApplied, 'restart-required': en.providerRestartRequired, overridden: en.providerOverridden,
      failed: en.providerFailed, cancelled: en.providerCancelled }[application]
    expect(await screen.findByText(text)).toBeTruthy()
  })

  it('reports unavailable and rejected management answers', async () => {
    const view = render(<MobileAgentCard {...base} listProviderEntries={async () => ({ kind: 'ready', entries: [entry(PROVIDER)] })}
      setProviderEnabled={async () => ({ kind: 'unavailable' })} />)
    fireEvent.click(await screen.findByRole('button', { name: en.mobileAgentDisable }))
    expect(await screen.findByText(en.providerManagementUnavailable)).toBeTruthy()
    view.rerender(<MobileAgentCard {...base} listProviderEntries={async () => ({ kind: 'ready', entries: [entry(PROVIDER)] })}
      setProviderEnabled={async () => ({ kind: 'rejected' })} revision={2} />)
    fireEvent.click(await screen.findByRole('button', { name: en.mobileAgentDisable }))
    expect((await screen.findByRole('alert')).textContent).toContain(en.providerRejected)
    view.rerender(<MobileAgentCard {...base} listProviderEntries={async () => ({ kind: 'ready', entries: [entry(PROVIDER)] })}
      setProviderEnabled={async () => { throw new Error('locked') }} revision={3} />)
    fireEvent.click(await screen.findByRole('button', { name: en.mobileAgentDisable }))
    expect((await screen.findByRole('alert')).textContent).toContain(en.providerRejected)
  })

  it('shows a pending control while a change is in flight', async () => {
    const release = Promise.withResolvers<Awaited<ReturnType<typeof base.setProviderEnabled>>>()
    const view = render(<MobileAgentCard {...base} listProviderEntries={async () => ({ kind: 'ready', entries: [entry(PROVIDER)] })}
      setProviderEnabled={() => release.promise} />)
    fireEvent.click(await screen.findByRole('button', { name: en.mobileAgentDisable }))
    expect(screen.getByRole('button', { name: en.providerChanging })).toHaveProperty('disabled', true)
    view.unmount()
    release.resolve({ kind: 'result', result: { changed: true, application: 'applied', stage: 'enable', target: 'x' as PluginEntryId } })
    await settle()
  })

  it('copies each example prompt and reports clipboard denial', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<MobileAgentCard {...base} listProviderEntries={async () => ({ kind: 'ready', entries: [] })} />)
    const copies = await screen.findAllByRole('button', { name: en.copyExample })
    expect(copies).toHaveLength(3)
    fireEvent.click(copies[0]!)
    expect(writeText).toHaveBeenCalledWith(en.mobileExample)
    expect(await screen.findByText(en.mobileCopied)).toBeTruthy()
    fireEvent.click(copies[1]!)
    expect((await screen.findByText(en.copyFailed)).textContent).toBe(en.copyFailed)
  })

  it('ignores inventory, change, and clipboard results that settle after the card unmounts', async () => {
    const writeText = vi.fn().mockResolvedValue(true)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const inventory = Promise.withResolvers<ProviderInventory>()
    const first = render(<MobileAgentCard {...base} listProviderEntries={() => inventory.promise} />)
    first.unmount()
    inventory.resolve({ kind: 'ready', entries: [entry(PROVIDER)] })
    await settle()
    const failure = Promise.withResolvers<ProviderInventory>()
    const second = render(<MobileAgentCard {...base} listProviderEntries={() => failure.promise} />)
    second.unmount()
    failure.reject(new Error('late inventory failure'))
    await settle()

    const change = Promise.withResolvers<Awaited<ReturnType<typeof base.setProviderEnabled>>>()
    const third = render(<MobileAgentCard {...base} listProviderEntries={async () => ({ kind: 'ready', entries: [entry(PROVIDER)] })}
      setProviderEnabled={() => change.promise} />)
    fireEvent.click(await screen.findByRole('button', { name: en.mobileAgentDisable }))
    fireEvent.click(screen.getAllByRole('button', { name: en.copyExample })[0]!)
    third.unmount()
    change.reject(new Error('late change failure'))
    await settle()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
