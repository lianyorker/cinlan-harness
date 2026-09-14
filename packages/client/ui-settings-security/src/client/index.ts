/** Cinlan capability settings registration plugin. */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SecurityResearchReportValue, SecurityResearchScopeSettings } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconBrowseOutline16,
  IconEnhanceOutline16,
  IconGlobeOutline14,
  IconPanelLeftOutline16,
  IconSkillOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { CAPABILITIES, CapabilitySection, type CapabilitySectionInjected } from './CapabilitySection.tsx'
import { en, zh, type CapabilitySettingsKey } from './locales.ts'
import type { BrowserPreferences } from '@deepseek-ai/dsh-browser-playwright/types'
import type { MobileDeviceSettings } from '../types.ts'
import { MOBILE_DEVICE_NAMESPACE } from '../types.ts'

export type { CapabilityId, CapabilityDefinition, CapabilitySectionInjected } from './CapabilitySection.tsx'
export type { MobileDeviceSettings } from '../types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Cinlan product capability settings copy. */
    'settings.cinlanCapabilities': CapabilitySettingsKey
  }
}

const NS = 'settings.cinlanCapabilities'

/** Services required by the Settings and Host inventory registrations. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory', 'remote.deviceCapabilities', 'remote.securityResearch', 'remote.browser', 'remote.settings', 'settingsScope']

const ICONS = {
  security: IconSkillOutline16,
  browser: IconGlobeOutline14,
  computer: IconBrowseOutline16,
  mobile: IconPanelLeftOutline16,
  design: IconEnhanceOutline16,
} as const

/** Register each capability as an independent Settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-security: dictionaries')
  const t = ctx.locale.bind(NS)
  const browserPreferences = ctx.settingsScope.bind<BrowserPreferences>({ namespace: 'browser-playwright' })
  const securityScope = ctx.settingsScope.bind<SecurityResearchScopeSettings>({ namespace: 'assessment-scope' })
  const mobileSettings = ctx.settingsScope.bind<MobileDeviceSettings>({ namespace: MOBILE_DEVICE_NAMESPACE })
  const list: CapabilitySectionInjected['list'] = async () => {
    const result = await ctx.remote.pluginInventory.list()
    if (!result.ok) throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
    return result.value
  }

  const checkDevice: CapabilitySectionInjected['checkDevice'] = async (capability, signal) => {
    const result = await ctx.remote.deviceCapabilities.check({ capability }, signal)
    if (!result.ok) throw new Error('Device readiness check failed')
    return result.value
  }
  const checkSdk: CapabilitySectionInjected['checkSdk'] = async (signal) => {
    const result = await ctx.remote.deviceCapabilities.checkSdk(signal)
    if (!result.ok) throw new Error('SDK detection failed')
    return result.value
  }
  const listMobileDevices: CapabilitySectionInjected['listMobileDevices'] = async (signal) => {
    const result = await ctx.remote.deviceCapabilities.listMobileDevices(signal)
    if (!result.ok) throw new Error('Device list failed')
    return result.value
  }
  const describeSecurity: CapabilitySectionInjected['describeSecurity'] = async (signal) => {
    const result = await ctx.remote.securityResearch.describe(signal)
    if (!result.ok) throw new Error(`securityResearch.describe failed: ${result.error.code}: ${result.error.message}`)
    return result.value
  }
  const exportReport = async (
    request: Parameters<typeof ctx.remote.securityResearch.exportReport>[0],
    signal: AbortSignal,
  ): Promise<SecurityResearchReportValue> => {
    const result = await ctx.remote.securityResearch.exportReport(request, signal)
    if (!result.ok) throw new Error(t('securityReportFailed'))
    return result.value
  }

  const register = (definition: (typeof CAPABILITIES)[number]): (() => void) => {
    const section = ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: `cinlan-${definition.id}`,
      order: definition.order,
      label: () => t(definition.navKey),
      locale: NS,
      inject: (): CapabilitySectionInjected => ({
        list, definition, checkDevice, checkSdk, listMobileDevices, describeSecurity,
        hooks: { browserPreferences, securityScope },
        mobileSettings,
        exportReport,
        saveSecurityScope: async (value, revision) => {
          const current = securityScope.getSnapshot()
          if (current.status !== 'ready' || !current.writable || current.mode !== 'host') throw new Error(t('securityScopeReadOnly'))
          const result = await ctx.remote.settings.mutate('assessment-scope', [
            { op: 'set', path: ['root', 'engagementId'], value: value.engagementId },
            { op: 'set', path: ['root', 'grantId'], value: value.grantId },
            { op: 'set', path: ['root', 'authorizationRef'], value: value.authorizationRef },
            { op: 'set', path: ['root', 'notBefore'], value: value.notBefore },
            { op: 'set', path: ['root', 'expiresAt'], value: value.expiresAt },
            { op: 'set', path: ['root', 'executionHostIds'], value: [...value.executionHostIds] },
            { op: 'set', path: ['root', 'targets'], value: value.targets.map(target => ({ ...target })) },
            { op: 'set', path: ['root', 'excludedTargetIds'], value: [...value.excludedTargetIds] },
            { op: 'set', path: ['root', 'egress'], value: value.egress.map(entry => ({ ...entry })) },
            { op: 'set', path: ['root', 'credentials'], value: value.credentials.map(entry => ({ ...entry })) },
            { op: 'set', path: ['root', 'actions'], value: [...value.actions] },
            { op: 'set', path: ['root', 'approvalRequiredActions'], value: [...value.approvalRequiredActions] },
            { op: 'set', path: ['root', 'evidence'], value: { ...value.evidence } },
          ], revision)
          if (!result.ok) throw new Error(t('securityScopeSaveFailed'))
          ctx.settingsScope.describe().acceptView(result.value)
        },
        browserControls: {
          snapshot: async (pageId, signal) => { const r = await ctx.remote.browser.snapshot({ pageId }, signal); if (!r.ok) throw new Error(t('browserOperationFailed')); return r.value },
          upload: async (request, signal) => { const r = await ctx.remote.browser.upload(request, signal); if (!r.ok) throw new Error(t('browserOperationFailed')); return r.value },
          downloads: async (pageId, signal) => { const r = await ctx.remote.browser.downloads({ pageId }, signal); if (!r.ok) throw new Error(t('browserOperationFailed')); return r.value },
          download: async (request, signal) => { const r = await ctx.remote.browser.download(request, signal); if (!r.ok) throw new Error(t('browserOperationFailed')); return r.value },
          pages: async (signal) => { const result = await ctx.remote.browser.pages(signal); if (!result.ok) throw new Error(t('browserOperationFailed')); return result.value },
          open: async (target, signal) => { const result = await ctx.remote.browser.open(target, signal); if (!result.ok) throw new Error(t('browserOperationFailed')); return result.value },
          history: async (pageId, signal) => { const result = await ctx.remote.browser.history({ pageId }, signal); if (!result.ok) throw new Error(t('browserOperationFailed')); return result.value },
          network: async (pageId, signal) => { const result = await ctx.remote.browser.network({ pageId }, signal); if (!result.ok) throw new Error(t('browserOperationFailed')); return result.value },
          importCookies: async (request, signal) => { const result = await ctx.remote.browser.importCookies(request, signal); if (!result.ok) throw new Error(t('browserCookieFailed')); return result.value },
        },
        saveBrowserPreferences: async (value, revision) => {
          await browserPreferences.mutate([
            { op: 'set', path: ['browserChannel'], value: value.browserChannel },
            { op: 'set', path: ['headless'], value: value.headless },
            { op: 'set', path: ['viewportWidth'], value: value.viewportWidth },
            { op: 'set', path: ['viewportHeight'], value: value.viewportHeight },
            { op: 'set', path: ['profileName'], value: value.profileName },
            { op: 'set', path: ['homePage'], value: value.homePage },
            { op: 'set', path: ['searchEngine'], value: value.searchEngine },
          ], revision)
          const saved = browserPreferences.getSnapshot()
          const fields = ['browserChannel', 'headless', 'viewportWidth', 'viewportHeight', 'profileName', 'homePage', 'searchEngine'] as const
          if (saved.status !== 'ready' || fields.some(field => saved.value?.[field] !== value[field])) {
            throw new Error(t('browserSettingsFailed'))
          }
        },
      }),
    }, CapabilitySection))
    const icon = ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
      name: 'settings.section.icon',
      key: `cinlan-${definition.id}`,
    }, ICONS[definition.id]))
    return () => { icon(); section() }
  }

  for (const definition of CAPABILITIES) {
    register(definition)
  }
}
