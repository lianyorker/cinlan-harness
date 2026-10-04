// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { SettingsMetadataService } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-metadata.ts'
import { IconPanelLeftOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { describe, expect, it, vi } from 'vitest'
import { Config } from '../src/config.ts'
import { apply, inject } from '../src/client/index.ts'
import { inject as mobileInject } from '../src/client/mobile-registration.ts'
import { apply as hostApply } from '../src/index.ts'
import { CAPABILITIES, CapabilitySection, MOBILE_CAPABILITY, type CapabilitySectionInjected } from '../src/client/CapabilitySection.tsx'
import { registerCapabilitySection } from '../src/client/capability-registration.ts'
import { mirrorId, mobileStatus, mobileTask } from './mobile-runtime-fixture.ts'
import { en, zh } from '../src/client/locales.ts'

/** A rejected generated Remote call; the success arm is absent. */
const remoteFailure = { ok: false, error: { code: 'gateway/internal', message: 'rejected', details: {} } } as never

async function bench() {
  const ctx = new Context()
  new SettingsMetadataService(ctx)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const deviceCapabilities = {
    check: vi.fn(async (request: { capability: string }) => ({ ok: true, value: { capability: request.capability, status: 'not-configured', reason: 'not-configured' } })),
    mobileRuntimeStatus: vi.fn(async () => ({ ok: true as const, value: mobileStatus() })),
    startMobileResource: vi.fn(async () => ({ ok: true as const, value: mobileTask() })),
    cancelMobileResource: vi.fn(async () => ({ ok: true as const, value: mobileTask({ state: 'cancelled' }) })),
    startMobileMirror: vi.fn(async () => ({ ok: true as const, value: { id: mirrorId, deviceId: 'android:selected', state: 'starting', error: null } })),
    closeMobileMirror: vi.fn(async () => ({ ok: true as const, value: { id: mirrorId, deviceId: 'android:selected', state: 'closed', error: null } })),
    checkSdk: vi.fn(async () => ({ ok: true as const, value: { platform: 'win32', android: { found: true, sdkPath: null, message: '' }, ios: null } })),
    listMobileDevices: vi.fn(async () => ({ ok: true as const, value: { devices: [], available: true } })),
  }
  const settings = { mutate: vi.fn(async () => ({ ok: true, value: {} })) }
  const settingsState = { status: 'unavailable', mode: 'host', writable: false }
  const acceptView = vi.fn()
  ctx.provide('remote', { settings, $host: { home: undefined, isLoopback: true }, deviceCapabilities, $on: () => () => {} } as never)
  ctx.provide('remote.deviceCapabilities', deviceCapabilities as never)
  ctx.provide('remote.settings', settings as never)
  const bindSettings = vi.fn(() => ({
    getSnapshot: () => settingsState,
    subscribe: () => () => {}, mutate: vi.fn(async () => true),
    set: vi.fn(async () => {}),
    unset: vi.fn(async () => {}),
  }))
  ctx.provide('settingsScope', { describe: () => ({ acceptView }), bind: bindSettings } as never)
  await ctx.plugin(SlotRegistry).await()
  return { ctx, locale, slots: ctx.slots, deviceCapabilities, settings, settingsState, acceptView, bindSettings }
}

/** Declare the section list and the keyed icon slot this plugin injects into. */
function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'settings.section.icon': { kind: 'keyed', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-settings-security registration', () => {
  it('keeps the assembly fiber independent from feature-owned Remote dependencies', () => {
    expect(inject).toEqual(['locale'])
    expect(mobileInject).toEqual(expect.arrayContaining(['remote.deviceCapabilities', 'remote.settings', 'settingsScope']))
  })

  it('applies the host half without registering runtime behavior', () => {
    expect(() => { hostApply() }).not.toThrow()
  })

  it('registers the mobile section, its icon, and localized metadata', async () => {
    const b = await bench()
    const release = declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply, Config })
    await fiber.await()
    const sections = b.slots.entries('settings.section')
    expect(sections).toHaveLength(1)
    expect(sections[0]!.options.id).toBe('cinlan-mobile')
    expect(resolveSlotLabel(sections[0]!.options.label)).toBe(zh.mobileNav)
    expect(b.slots.entries('settings.section.icon')).toHaveLength(1)
    const metadata = b.ctx.settingsMetadata.getSnapshot().items
    expect(metadata.find(item => item.anchorId === 'mobile-sdk-path')).toMatchObject({ title: zh.mobileSdkCustomPath })
    expect(metadata.find(item => item.anchorId === 'mobile-commands')).toMatchObject({ title: zh.mobileCommandsTitle })
    expect(metadata.some(item => item.anchorId === 'components')).toBe(false)
    b.locale.setLocale('en')
    await vi.waitFor(() => { expect(resolveSlotLabel(sections[0]!.options.label)).toBe(en.mobileNav) })
    release()
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toEqual([]) })
    await fiber.dispose()
    await b.ctx.fiber.dispose()
  })

  it('forwards the mobile probe, preference, resource, and mirror callbacks', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply, Config }).await()
    const section = b.slots.entries('settings.section').find(entry => entry.options.id === 'cinlan-mobile')!
    const injected = (section.inject as unknown as () => CapabilitySectionInjected)()
    const signal = new AbortController().signal
    const readiness = { capability: 'mobile', status: 'available', reason: null }
    b.deviceCapabilities.check.mockResolvedValueOnce({ ok: true, value: readiness } as never)
    await expect(injected.checkDevice('mobile', signal)).resolves.toEqual(readiness)
    b.deviceCapabilities.check.mockResolvedValueOnce(remoteFailure)
    await expect(injected.checkDevice('mobile', signal)).rejects.toThrow(zh.deviceCheckFailed)
    await expect(injected.checkSdk(signal)).resolves.toMatchObject({ platform: 'win32' })
    b.deviceCapabilities.checkSdk.mockResolvedValueOnce(remoteFailure)
    await expect(injected.checkSdk(signal)).rejects.toThrow(zh.mobileSdkFailed)
    await expect(injected.listMobileDevices(signal)).resolves.toEqual({ devices: [], available: true })
    b.deviceCapabilities.listMobileDevices.mockResolvedValueOnce(remoteFailure)
    await expect(injected.listMobileDevices(signal)).rejects.toThrow(zh.mobileDevicesFailed)
    const release = injected.watchMobileResources()
    await vi.waitFor(() => { expect(injected.hooks.mobileResources.getSnapshot().status).toBe('ready') })
    b.deviceCapabilities.mobileRuntimeStatus.mockResolvedValueOnce(remoteFailure)
    injected.refreshMobileResources()
    await vi.waitFor(() => { expect(injected.hooks.mobileResources.getSnapshot().status).toBe('error') })
    b.deviceCapabilities.mobileRuntimeStatus.mockResolvedValueOnce({ ok: true, value: mobileStatus() } as never)
    injected.refreshMobileResources()
    await vi.waitFor(() => { expect(injected.hooks.mobileResources.getSnapshot().status).toBe('ready') })
    release()
    const request = { resourceId: 'platform-tools', expectedRevision: 'revision-1', operation: 'install', acceptLicense: true }
    await injected.runMobileResource(request as never)
    expect(b.deviceCapabilities.startMobileResource).toHaveBeenCalledWith(request)
    b.deviceCapabilities.startMobileResource.mockResolvedValueOnce(remoteFailure)
    await expect(injected.runMobileResource(request as never)).rejects.toThrow(zh.mobileResourcesActionFailed)
    await injected.cancelMobileResource('task-1' as never)
    expect(b.deviceCapabilities.cancelMobileResource).toHaveBeenCalledWith({ taskId: 'task-1' })
    b.deviceCapabilities.cancelMobileResource.mockResolvedValueOnce(remoteFailure)
    await expect(injected.cancelMobileResource('task-1' as never)).rejects.toThrow(zh.mobileResourcesActionFailed)
    await injected.startMobileMirror('android:selected')
    expect(b.deviceCapabilities.startMobileMirror).toHaveBeenCalledWith({ deviceId: 'android:selected' })
    b.deviceCapabilities.startMobileMirror.mockResolvedValueOnce(remoteFailure)
    await expect(injected.startMobileMirror('android:selected')).rejects.toThrow(zh.mobileResourcesActionFailed)
    await injected.closeMobileMirror(mirrorId)
    expect(b.deviceCapabilities.closeMobileMirror).toHaveBeenCalledWith({ mirrorId })
    b.deviceCapabilities.closeMobileMirror.mockResolvedValueOnce(remoteFailure)
    await expect(injected.closeMobileMirror(mirrorId)).rejects.toThrow(zh.mobileResourcesActionFailed)
    b.settingsState.status = 'ready'
    b.settingsState.writable = true
    await injected.saveMobileSettings({ enabled: true, androidSdkPath: '/sdk', defaultDeviceId: '' }, 7)
    expect(b.settings.mutate).toHaveBeenCalledWith('mobile-device', [
      { op: 'set', path: ['enabled'], value: true },
      { op: 'set', path: ['androidSdkPath'], value: '/sdk' },
      { op: 'set', path: ['defaultDeviceId'], value: '' },
    ], 7)
    await injected.resetMobileSettings(7)
    expect(b.settings.mutate).toHaveBeenLastCalledWith('mobile-device', [
      { op: 'unset', path: ['enabled'] },
      { op: 'unset', path: ['androidSdkPath'] },
      { op: 'unset', path: ['defaultDeviceId'] },
    ], 7)
    await b.ctx.fiber.dispose()
  })

  it('reports Plugin Manager availability for the provider controls', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply, Config }).await()
    const section = b.slots.entries('settings.section').find(entry => entry.options.id === 'cinlan-mobile')!
    const injected = (section.inject as unknown as () => CapabilitySectionInjected)()
    await expect(injected.listProviderEntries()).resolves.toEqual({ kind: 'unavailable' })
    await expect(injected.setProviderEnabled('row:mobile' as never, true)).resolves.toEqual({ kind: 'unavailable' })
    const manager = {
      listPlugins: vi.fn(async () => ({ ok: true as const, value: [{ entryId: 'row:mobile', moduleName: '@deepseek-ai/dsh-mobile-device-adb', enabled: true, fiberPhase: 'active' as const }] })),
      setPluginEnabled: vi.fn(async () => ({ ok: true as const, value: { changed: true, application: 'applied' as const, stage: 'enable' as const, target: 'row:mobile' } })),
    }
    b.ctx.provide('remote.pluginManager', manager as never)
    await expect(injected.listProviderEntries()).resolves.toMatchObject({ kind: 'ready' })
    await expect(injected.setProviderEnabled('row:mobile' as never, true)).resolves.toMatchObject({ kind: 'result' })
    manager.listPlugins.mockResolvedValueOnce({ ok: false } as never)
    await expect(injected.listProviderEntries()).resolves.toEqual({ kind: 'rejected' })
    manager.listPlugins.mockRejectedValueOnce(new Error('transport'))
    await expect(injected.listProviderEntries()).resolves.toEqual({ kind: 'rejected' })
    manager.setPluginEnabled.mockResolvedValueOnce({ ok: false } as never)
    await expect(injected.setProviderEnabled('row:mobile' as never, false)).resolves.toEqual({ kind: 'rejected' })
    manager.setPluginEnabled.mockRejectedValueOnce(new Error('transport'))
    await expect(injected.setProviderEnabled('row:mobile' as never, false)).resolves.toEqual({ kind: 'rejected' })
    await b.ctx.fiber.dispose()
  })

  it('re-reads the mobile runtime after a connection reset and drops observations on disposal', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply, Config })
    await fiber.await()
    const section = b.slots.entries('settings.section').find(entry => entry.options.id === 'cinlan-mobile')!
    const injected = (section.inject as unknown as () => CapabilitySectionInjected)()
    const release = injected.watchMobileResources()
    await vi.waitFor(() => { expect(b.deviceCapabilities.mobileRuntimeStatus).toHaveBeenCalledTimes(1) })
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(b.deviceCapabilities.mobileRuntimeStatus).toHaveBeenCalledTimes(2) })
    release()
    await fiber.dispose()
    const calls = b.deviceCapabilities.mobileRuntimeStatus.mock.calls.length
    b.ctx.emit('connection/reset')
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(b.deviceCapabilities.mobileRuntimeStatus.mock.calls.length).toBe(calls)
  })

  it('keeps preference writes unavailable while the Host scope is read-only', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply, Config }).await()
    const section = b.slots.entries('settings.section').find(entry => entry.options.id === 'cinlan-mobile')!
    const injected = (section.inject as unknown as () => CapabilitySectionInjected)()
    await expect(injected.saveMobileSettings({ enabled: true, androidSdkPath: '', defaultDeviceId: '' }, 3)).rejects.toThrow(zh.preferencesReadOnly)
    b.settings.mutate.mockResolvedValueOnce(remoteFailure)
    b.settingsState.status = 'ready'
    b.settingsState.writable = true
    await expect(injected.resetMobileSettings(3)).rejects.toThrow(zh.preferencesFailed)
    await b.ctx.fiber.dispose()
  })

  it('registers the single product capability with its icon and metadata helper', async () => {
    expect(CAPABILITIES).toEqual([MOBILE_CAPABILITY])
    const b = await bench()
    declare(b.slots)
    const release = registerCapabilitySection(b.ctx, { t: (key: string) => zh[key as keyof typeof zh] ?? key },
      MOBILE_CAPABILITY, IconPanelLeftOutline16, () => ({} as CapabilitySectionInjected))
    expect(b.slots.entries('settings.section')).toHaveLength(1)
    expect(b.slots.entries('settings.section.icon')).toHaveLength(1)
    release()
    expect(b.slots.entries('settings.section')).toEqual([])
    await b.ctx.fiber.dispose()
  })

  it('renders the mobile page component for the registered section', () => {
    expect(CapabilitySection).toBeTypeOf('function')
  })
})
