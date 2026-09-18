// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { SettingsMetadataService } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-metadata.ts'
import { IconSkillOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  PluginEntryId, PluginInventorySnapshot,
} from '@deepseek-ai/dsh-host-plugin-inventory/types'
import { describe, expect, it, vi } from 'vitest'
import type { SecurityResearchScopeSettings } from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { CAPABILITIES, CapabilitySection, type CapabilitySectionInjected } from '../src/client/CapabilitySection.tsx'
import { en, zh } from '../src/client/locales.ts'

function entry(moduleName: string, active: boolean) {
  return {
    entryId: moduleName as PluginEntryId,
    moduleName,
    enabled: active,
    fiberPhase: active ? ('active' as const) : ('pending' as const),
  }
}

function snapshot(names: readonly string[]): PluginInventorySnapshot {
  return { entries: names.map(name => entry(name, true)) }
}

async function bench(list: () => Promise<{ ok: boolean }>, presetIds = ['security-research']) {
  const ctx = new Context()
  new SettingsMetadataService(ctx)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const agentPresets = { list: vi.fn(async () => ({ ok: true as const, value: { presets: presetIds.map(id => ({ id, trust: 'system' as const, isDefault: false })), authorable: true } })) }
  const inventory = { list: vi.fn(list) }
  const deviceCapabilities = { check: vi.fn(async (request: { capability: string }) => ({ ok: true, value: { capability: request.capability, status: 'not-configured', reason: 'not-configured' } })) }
  const securityResearch = { describe: vi.fn(async () => ({ ok: true, value: { status: 'not-configured', preset: { present: true, trust: 'system' }, scope: { present: true, state: 'empty', targetCount: 0, actionCount: 0, executionHostCount: 0, egressCount: 0, credentialCount: 0 }, components: { assessmentScope: true, findings: true, artifacts: true, vulnerabilityKnowledgeBase: true, securitySkills: true, workflowPrompt: true, findingTools: true }, skillCount: 24, skillsComplete: true } })) }
  const settings = { mutate: vi.fn(async () => ({ ok: true, value: {} })) }
  const settingsState = { status: 'unavailable', mode: 'host', writable: false }
  const acceptView = vi.fn()
  ctx.provide('remote', { settings, $host: { home: undefined, isLoopback: true }, pluginInventory: inventory, deviceCapabilities, agentPresets, securityResearch, browser: {}, $on: () => () => {} } as never)
  ctx.provide('remote.agentPresets', agentPresets as never)
  ctx.provide('remote.deviceCapabilities', deviceCapabilities as never)
  ctx.provide('remote.pluginInventory', inventory as never)
  ctx.provide('remote.securityResearch', securityResearch as never)
  ctx.provide('remote.browser', {} as never)
  ctx.provide('remote.settings', settings as never)
  const bindSettings = vi.fn(() => ({
    getSnapshot: () => settingsState,
    subscribe: () => () => {}, mutate: vi.fn(async () => true),
    set: vi.fn(async () => {}),
    unset: vi.fn(async () => {}),
  }))
  ctx.provide('settingsScope', { describe: () => ({ acceptView }), bind: bindSettings } as never)
  const registerSettings = vi.fn()
  ctx.provide('settings', { register: registerSettings })
  await ctx.plugin(SlotRegistry).await()
  return { ctx, locale, slots: ctx.slots, inventory, deviceCapabilities, agentPresets, securityResearch,
    settings, settingsState, acceptView, bindSettings, registerSettings }
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
  it('declares the plugin inventory Remote it reads', () => {
    expect(inject).toEqual(['settingsMetadata', 'slots', 'locale', 'remote', 'remote.pluginInventory', 'remote.deviceCapabilities', 'remote.securityResearch', 'remote.browser', 'remote.settings', 'settingsScope'])
  })

  it('registers one localized section and icon per product capability, without eager reads', async () => {
    const b = await bench(async () => ({ ok: true as const, value: snapshot([]) } as never))
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(CAPABILITIES.length) })
    const sections = [...b.slots.entries('settings.section')].sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0))
    expect(sections).toHaveLength(CAPABILITIES.length)
    expect(b.inventory.list).not.toHaveBeenCalled()

    for (const [index, definition] of CAPABILITIES.entries()) {
      const section = sections[index]!
      expect(section.component).toBe(CapabilitySection)
      expect(section.options).toMatchObject({ id: `cinlan-${definition.id}`, order: definition.order })
      expect(section.locale).toBe('settings.cinlanCapabilities')
      expect(resolveSlotLabel(section.options.label)).toBe(zh[definition.navKey])
    }

    const security = sections[0]!
    b.locale.setLocale('en')
    expect(resolveSlotLabel(security.options.label)).toBe(en[CAPABILITIES[0]!.navKey])

    const icons = [...b.slots.entries('settings.section.icon')].sort((a, b) => CAPABILITIES.findIndex(d => 'cinlan-' + d.id === a.options.key) - CAPABILITIES.findIndex(d => 'cinlan-' + d.id === b.options.key))
    expect(icons.map(icon => icon.options.key)).toEqual(CAPABILITIES.map(definition => `cinlan-${definition.id}`))
    expect(icons[0]!.component).toBe(IconSkillOutline16)

    await b.ctx.plugin({ apply: hostApply }).await()
    expect(b.registerSettings).not.toHaveBeenCalled()
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toEqual([])
    expect(b.slots.entries('settings.section.icon')).toEqual([])
    await b.ctx.fiber.dispose()
  })

  it('writes advanced scope rows atomically, accepts only successful views, and refuses read-only writes', async () => {
    const b = await bench(async () => ({ ok: true, value: snapshot([]) }))
    try {
      declare(b.slots)
      await b.ctx.plugin({ inject, apply }).await()
      const section = b.slots.entries('settings.section')[0]!
      const injected = (section.inject as unknown as () => CapabilitySectionInjected)()
      const root: SecurityResearchScopeSettings['root'] = {
        engagementId: 'engagement', grantId: 'grant', authorizationRef: 'auth', notBefore: 0, expiresAt: 100,
        executionHostIds: ['host'], targets: [{ id: 'target', kind: 'hostname', value: 'example.test' }], excludedTargetIds: [],
        actions: ['reconnaissance'], approvalRequiredActions: [],
        egress: [{ protocol: 'https', host: 'example.test', port: 443, purpose: 'target-access', targetId: 'target' }],
        credentials: [{ ref: 'FIXTURE_REFERENCE', purpose: 'target-authentication', targetId: 'target' }],
        evidence: { retainUntil: 100, minimumRedaction: 'sensitive', externalReporting: 'deny' },
      }
      await expect(injected.saveSecurityScope(root, 4)).rejects.toThrow(zh.securityScopeReadOnly)
      expect(b.settings.mutate).not.toHaveBeenCalled()
      b.settingsState.status = 'ready'
      b.settingsState.writable = true
      await injected.saveSecurityScope(root, 4)
      expect(b.settings.mutate).toHaveBeenCalledExactlyOnceWith('assessment-scope', expect.arrayContaining([
        { op: 'set', path: ['root', 'egress'], value: root.egress },
        { op: 'set', path: ['root', 'credentials'], value: root.credentials },
      ]), 4)
      expect(b.acceptView).toHaveBeenCalledExactlyOnceWith({})
      b.settings.mutate.mockResolvedValueOnce({ ok: false, error: { message: 'private-diagnostic' } } as never)
      await expect(injected.saveSecurityScope(root, 4)).rejects.toThrow(zh.securityScopeSaveFailed)
      expect(b.acceptView).toHaveBeenCalledTimes(1)
      await injected.saveSecurityScope({ ...root, egress: [], credentials: [] }, 5)
      expect(b.settings.mutate).toHaveBeenLastCalledWith('assessment-scope', expect.arrayContaining([
        { op: 'set', path: ['root', 'egress'], value: [] }, { op: 'set', path: ['root', 'credentials'], value: [] },
      ]), 5)
    } finally { await b.ctx.fiber.dispose() }
  })

  it('shares one inventory-reading callback across every registered section', async () => {
    const active = snapshot(['@deepseek-ai/dsh-security-skills'])
    const b = await bench(async () => ({ ok: true as const, value: active } as never))
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const sections = b.slots.entries('settings.section')

    for (const section of sections) {
      const injected = (section.inject as unknown as () => CapabilitySectionInjected)()
      await expect(injected.list()).resolves.toEqual(active)
    }
    expect(b.inventory.list).toHaveBeenCalledTimes(sections.length)
    await b.ctx.fiber.dispose()
  })

  it('surfaces a Remote failure message from the shared list callback', async () => {
    const b = await bench(async () => ({ ok: false as const, error: { code: 'gateway/internal', message: 'inventory offline', details: {} } } as never))
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const section = b.slots.entries('settings.section')[0]!
    const injected = (section.inject as unknown as () => CapabilitySectionInjected)()
    await expect(injected.list()).rejects.toThrow('inventory offline')
    await b.ctx.fiber.dispose()
  })

  it('forwards readiness requests and cancellation through the generated namespace', async () => {
    const b = await bench(async () => ({ ok: true, value: snapshot([]) }))
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const injected = (entry.inject as unknown as () => CapabilitySectionInjected)()
    const signal = new AbortController().signal
    await expect(injected.checkDevice('computer', signal)).resolves.toMatchObject({ status: 'not-configured' })
    expect(b.deviceCapabilities.check).toHaveBeenCalledWith({ capability: 'computer' }, signal)
    b.deviceCapabilities.check.mockResolvedValueOnce({ ok: false } as never)
    await expect(injected.checkDevice('computer', signal)).rejects.toThrow(zh.deviceCheckFailed)
    await b.ctx.fiber.dispose()
  })

  it('registers all capabilities unconditionally without reading agent presets', async () => {
    const b = await bench(async () => ({ ok: true, value: snapshot(['@deepseek-ai/dsh-skill', '@deepseek-ai/dsh-client-ui-settings-security']) }), [])
    declare(b.slots)
    await b.ctx.plugin({ inject, apply }).await()
    expect(b.agentPresets.list).not.toHaveBeenCalled()
    expect(b.slots.entries('settings.section')).toHaveLength(CAPABILITIES.length)
    expect(b.slots.entries('settings.section').map(e => e.options.id)).toContain('cinlan-security')
    expect(b.slots.entries('settings.section.icon').map(e => e.options.key)).toContain('cinlan-security')
    await b.ctx.fiber.dispose()
  })

  it('waits for the settings declaration and follows its lifetime', async () => {
    const b = await bench(async () => ({ ok: true as const, value: snapshot([]) } as never))
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toEqual([])

    const release = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(CAPABILITIES.length) })
    release()
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toEqual([]) })
    await fiber.dispose()
    await b.ctx.fiber.dispose()
  })
  it('indexes localized public fields and removes them with the section', async () => {
    const b = await bench(async () => ({ ok: true as const, value: snapshot([]) } as never))
    const release = declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const metadata = b.ctx.settingsMetadata.getSnapshot().items
    expect(metadata.some(item => item.anchorId === 'browser-homepage' && item.title === zh.browserHomePage)).toBe(true)
    expect(metadata.find(item => item.anchorId === 'browser-link-routing'))
      .toMatchObject({ title: zh.browserRouteLinks, description: zh.browserRouteLinksHelp })
    expect(metadata.find(item => item.anchorId === 'computer-observations'))
      .toMatchObject({ title: zh.computerMachine, description: zh.computerLocalLimit })
    expect(metadata.find(item => item.anchorId === 'computer-permissions'))
      .toMatchObject({ title: zh.computerPermissions, description: zh.computerPermissionsHelp })
    expect(metadata.find(item => item.anchorId === 'mobile-sdk-path'))
      .toMatchObject({ title: zh.mobileSdkCustomPath, description: zh.mobileSdkPathHelp })
    expect(metadata.find(item => item.anchorId === 'mobile-device'))
      .toMatchObject({ description: zh.mobileDefaultDeviceDescription })
    expect(metadata.some(item => item.anchorId === 'security-credentials')).toBe(true)
    b.locale.setLocale('en')
    await vi.waitFor(() => {
      expect(b.ctx.settingsMetadata.getSnapshot().items.some(item => item.title === en.browserHomePage)).toBe(true)
      expect(b.ctx.settingsMetadata.getSnapshot().items.find(item => item.anchorId === 'browser-link-routing'))
        .toMatchObject({ title: en.browserRouteLinks, description: en.browserRouteLinksHelp })
      expect(b.ctx.settingsMetadata.getSnapshot().items.find(item => item.anchorId === 'mobile-device'))
        .toMatchObject({ description: en.mobileDefaultDeviceDescription })
    })
    expect(JSON.stringify(metadata)).not.toContain('credentialRef')
    release()
    expect(b.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
    declare(b.slots)
    expect(b.ctx.settingsMetadata.getSnapshot().items).toHaveLength(metadata.length)
    await fiber.dispose()
    expect(b.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
    await b.ctx.fiber.dispose()
  })

  it('writes mobile fields and removes preference overrides only after successful Host mutations', async () => {
    const b = await bench(async () => ({ ok: true as const, value: snapshot([]) } as never))
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    Object.assign(b.settingsState, { status: 'ready', writable: true })
    const mobile = b.slots.entries('settings.section').find(section => section.options.id === 'cinlan-mobile')!
    const injected = (mobile.inject as unknown as () => CapabilitySectionInjected)()
    expect(b.bindSettings).toHaveBeenCalledWith({ namespace: 'mobile-device' })
    const value = { enabled: true, androidSdkPath: 'D:/sdk', defaultDeviceId: 'saved-device' }
    await injected.saveMobileSettings(value, 21)
    expect(b.settings.mutate).toHaveBeenLastCalledWith('mobile-device', [
      { op: 'set', path: ['enabled'], value: true },
      { op: 'set', path: ['androidSdkPath'], value: 'D:/sdk' },
      { op: 'set', path: ['defaultDeviceId'], value: 'saved-device' },
    ], 21)
    expect(b.acceptView).toHaveBeenCalledTimes(1)
    b.settings.mutate.mockResolvedValueOnce({ ok: false, value: {} })
    await expect(injected.resetMobileSettings(22)).rejects.toThrow(zh.preferencesFailed)
    expect(b.acceptView).toHaveBeenCalledTimes(1)
    await injected.resetMobileSettings(23)
    expect(b.settings.mutate).toHaveBeenLastCalledWith('mobile-device', [
      { op: 'unset', path: ['enabled'] }, { op: 'unset', path: ['androidSdkPath'] }, { op: 'unset', path: ['defaultDeviceId'] },
    ], 23)
    await injected.resetBrowserPreferences(24)
    expect(b.settings.mutate).toHaveBeenLastCalledWith('browser-playwright', expect.arrayContaining([
      { op: 'unset', path: ['homePage'] }, { op: 'unset', path: ['profileName'] },
    ]), 24)
    expect(b.bindSettings).toHaveBeenCalledWith({ namespace: 'dsh-better-sidebar' })
    const routingMutation = vi.mocked(injected.hooks.browserRouting.mutate)
    await injected.saveBrowserRouting({ browserInterceptHttps: true }, 26)
    expect(routingMutation).toHaveBeenLastCalledWith([{ op: 'set', path: ['browserInterceptHttps'], value: true }], 26)
    routingMutation.mockResolvedValueOnce(false)
    await expect(injected.resetBrowserRouting(27)).rejects.toThrow(zh.browserSettingsFailed)
    await injected.resetBrowserRouting(28)
    expect(routingMutation).toHaveBeenLastCalledWith([
      { op: 'unset', path: ['browserInterceptLinks'] },
      { op: 'unset', path: ['browserInterceptHttp'] },
      { op: 'unset', path: ['browserInterceptHttps'] },
    ], 28)
    routingMutation.mockResolvedValueOnce(false)
    await expect(injected.saveBrowserRouting({ browserInterceptHttp: false }, 29)).rejects.toThrow(zh.browserSettingsFailed)
    const accepted = b.acceptView.mock.calls.length
    b.settingsState.writable = false
    await expect(injected.saveMobileSettings(value, 25)).rejects.toThrow(zh.preferencesReadOnly)
    expect(b.acceptView).toHaveBeenCalledTimes(accepted)
    expect(JSON.stringify(b.ctx.settingsMetadata.getSnapshot().items)).not.toContain('saved-device')
    await b.ctx.fiber.dispose()
  })
})
