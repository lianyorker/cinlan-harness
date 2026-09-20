/** Cinlan capability settings registration plugin. */
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  IconBrowseOutline16,
  IconGlobeOutline14,
  IconPanelLeftOutline16,
  IconSkillOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { CAPABILITIES, CapabilitySection, type CapabilitySectionInjected } from './CapabilitySection.tsx'
import { SecurityResourcesSection, type SecurityResourcesInjected, type SecurityResourceAction } from './SecurityResourcesSection.tsx'
import { createSecurityResourceObserver } from './resource-observer.ts'
import { createBrowserResourceObserver } from './browser-resources.ts'
import { createMobileResourceObserver } from './mobile-resources.ts'
import type { Config } from '../config.ts'
import type { ProviderActivationCallbacks } from './ProviderActivation.tsx'
export { Config } from '../config.ts'
import { en, zh, type CapabilitySettingsKey } from './locales.ts'
import type { BrowserPreferences } from '@deepseek-ai/dsh-browser-playwright/types'
import type { MobileDeviceSettings } from '@deepseek-ai/dsh-mobile-device/types'
import type { SidebarPrefs } from '@deepseek-ai/dsh-client-ui-better-sidebar/client/service'
import { BROWSER_FIELDS, BROWSER_ROUTING_FIELDS, CAPABILITY_FIELDS } from './settings-fields.ts'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

export type { CapabilityId, CapabilityDefinition, CapabilitySectionInjected } from './CapabilitySection.tsx'
export type { MobileDeviceSettings } from '@deepseek-ai/dsh-mobile-device/types'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Cinlan product capability settings copy. */
    'settings.cinlanCapabilities': CapabilitySettingsKey
  }
}

const NS = 'settings.cinlanCapabilities'

/** Services required by the Settings and Host inventory registrations. */
export const inject = ['settingsMetadata', 'slots', 'locale', 'remote', 'remote.pluginInventory', 'remote.deviceCapabilities', 'remote.securityResearch', 'remote.browser', 'remote.settings', 'settingsScope']

const ICONS = {
  security: IconSkillOutline16,
  browser: IconGlobeOutline14,
  computer: IconBrowseOutline16,
  mobile: IconPanelLeftOutline16,
} as const

/** Register each capability as an independent Settings section. */
export function apply(ctx: ClientContext, config: Config): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-security: dictionaries')
  const t = ctx.locale.bind(NS)
  const browserPreferences = ctx.settingsScope.bind<BrowserPreferences>({ namespace: 'browser-playwright' })
  const browserRouting = ctx.settingsScope.bind<SidebarPrefs>({ namespace: 'dsh-better-sidebar' })
  const mobileSettings = ctx.settingsScope.bind<MobileDeviceSettings>({ namespace: 'mobile-device' })
  const browserResources = createBrowserResourceObserver(async (signal) => {
    const result = await ctx.remote.browser.runtimeStatus(signal)
    if (!result.ok) throw new Error(t('browserOperationFailed'))
    return result.value
  }, config.runtimePollIntervalMs)
  ctx.effect(() => browserResources.dispose)
  ctx.on('connection/reset', () => { browserResources.refresh() })
  const mobileResources = createMobileResourceObserver(async (signal) => {
    const result = await ctx.remote.deviceCapabilities.mobileRuntimeStatus(signal)
    if (!result.ok) throw new Error(t('mobileResourcesReadFailed'))
    return result.value
  }, config.runtimePollIntervalMs)
  ctx.effect(() => mobileResources.dispose)
  ctx.on('connection/reset', () => { mobileResources.refresh() })
  const mutatePreferences = async (
    namespace: string,
    scope: SettingsScope<unknown>,
    operations: readonly SettingsPathOpView[],
    revision: number,
    errorKey: 'browserSettingsFailed' | 'preferencesFailed',
  ): Promise<void> => {
    const current = scope.getSnapshot()
    if (current.status !== 'ready' || !current.writable || current.mode !== 'host') throw new Error(t('preferencesReadOnly'))
    const result = await ctx.remote.settings.mutate(namespace, [...operations], revision)
    if (!result.ok) throw new Error(t(errorKey))
    ctx.settingsScope.describe().acceptView(result.value)
  }
  const list: CapabilitySectionInjected['list'] = async () => {
    const result = await ctx.remote.pluginInventory.list()
    if (!result.ok) throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
    return result.value
  }

  const providerActivation: ProviderActivationCallbacks = {
    listProviderEntries: async () => {
      const manager = ctx.get('remote.pluginManager') as ClientContext['remote']['pluginManager'] | undefined
      if (manager === undefined) return { kind: 'unavailable' }
      try {
        const result = await manager.listPlugins()
        return result.ok ? { kind: 'ready', entries: result.value } : { kind: 'rejected' }
      } catch (_managementTransportRejected) { return { kind: 'rejected' } }
    },
    setProviderEnabled: async (entryId, enabled) => {
      const manager = ctx.get('remote.pluginManager') as ClientContext['remote']['pluginManager'] | undefined
      if (manager === undefined) return { kind: 'unavailable' }
      try {
        const result = await manager.setPluginEnabled(entryId, enabled)
        return result.ok ? { kind: 'result', result: result.value } : { kind: 'rejected' }
      } catch (_managementTransportRejected) { return { kind: 'rejected' } }
    },
  }

  const checkDevice: CapabilitySectionInjected['checkDevice'] = async (capability, signal) => {
    const result = await ctx.remote.deviceCapabilities.check({ capability }, signal)
    if (!result.ok) throw new Error(t('deviceCheckFailed'))
    return result.value
  }
  const checkSdk: CapabilitySectionInjected['checkSdk'] = async (signal) => {
    const result = await ctx.remote.deviceCapabilities.checkSdk(signal)
    if (!result.ok) throw new Error(t('mobileSdkFailed'))
    return result.value
  }
  const listMobileDevices: CapabilitySectionInjected['listMobileDevices'] = async (signal) => {
    const result = await ctx.remote.deviceCapabilities.listMobileDevices(signal)
    if (!result.ok) throw new Error(t('mobileDevicesFailed'))
    return result.value
  }
  const resources = createSecurityResourceObserver(ctx.remote.securityResearch)
  ctx.effect(() => () => { resources.dispose() }, 'ui-settings-security: resource observations')
  ctx.on('connection/reset', () => { resources.refresh() })
  const operations = {
    'check-update': () => ctx.remote.securityResearch.checkResourceUpdate(),
    install: () => ctx.remote.securityResearch.installResource(),
    reinstall: () => ctx.remote.securityResearch.reinstallResource(),
    update: () => ctx.remote.securityResearch.updateResource(),
    'install-bundled': () => ctx.remote.securityResearch.installBundledResource(),
    remove: () => ctx.remote.securityResearch.removeResource(),
  } satisfies Record<SecurityResourceAction, () => Promise<unknown>>
  const resourceInjected = (): SecurityResourcesInjected => ({
    hooks: { securityResources: resources.store }, watch: resources.watch, refresh: resources.refresh,
    run: async (action) => {
      const result = await operations[action]()
      resources.refresh()
      if (!result.ok) throw new Error(t('resourceActionFailed'))
    },
    cancel: async (operationId) => {
      const result = await ctx.remote.securityResearch.cancelResource({ operationId })
      resources.refresh()
      if (!result.ok) throw new Error(t('resourceActionFailed'))
    },
  })

  const register = (definition: (typeof CAPABILITIES)[number]): (() => void) => {
    const section = ctx.slots.inject('settings.section', function* () {
      yield ctx.settingsMetadata.registerSection({ sectionId: `cinlan-${definition.id}`, groupId: 'tools' })
      if (definition.id === 'security') {
        yield ctx.settingsMetadata.registerItems('cinlan-security', [
          ...CAPABILITY_FIELDS.security.map(field => ({
            id: field.title, anchorId: field.anchorId, title: () => t(field.title),
            description: () => t(field.description), keywords: () => [t('securityNav')],
          })),
        ])
        yield ctx.slots.register({
          name: 'settings.section', id: 'cinlan-security', order: definition.order,
          label: () => t(definition.navKey), locale: NS, inject: resourceInjected,
        }, SecurityResourcesSection)
        return
      }
      const capabilityDefinition: CapabilitySectionInjected['definition'] = { ...definition, id: definition.id }
      yield ctx.settingsMetadata.registerItems(`cinlan-${definition.id}`, [
        ...CAPABILITY_FIELDS[definition.id].map(field => ({
          id: field.title, anchorId: field.anchorId, title: () => t(field.title), description: () => t(field.description),
          keywords: () => [t(definition.navKey)],
        })),
        { id: 'components', anchorId: definition.id + '-components', title: () => t('hostFact'),
          description: () => t('inventoryCaveat'), keywords: () => [t(definition.navKey)] },
      ])
      yield ctx.slots.register({
        name: 'settings.section',
        id: `cinlan-${definition.id}`,
        order: definition.order,
        label: () => t(definition.navKey),
        locale: NS,
        inject: (): CapabilitySectionInjected => ({
          ...providerActivation, list, definition: capabilityDefinition, checkDevice, checkSdk, listMobileDevices,
          hooks: { browserPreferences, browserRouting, mobileSettings, browserResources: browserResources.store,
            mobileResources: mobileResources.store },
          watchMobileResources: mobileResources.watch,
          refreshMobileResources: mobileResources.refresh,
          runMobileResource: async (request) => {
            const result = await ctx.remote.deviceCapabilities.startMobileResource(request)
            if (!result.ok) throw new Error(t('mobileResourcesActionFailed'))
            mobileResources.refresh()
          },
          cancelMobileResource: async (taskId) => {
            const result = await ctx.remote.deviceCapabilities.cancelMobileResource({ taskId })
            if (!result.ok) throw new Error(t('mobileResourcesActionFailed'))
            mobileResources.refresh()
          },
          startMobileMirror: async (deviceId) => {
            const result = await ctx.remote.deviceCapabilities.startMobileMirror({ deviceId })
            if (!result.ok) throw new Error(t('mobileResourcesActionFailed'))
            mobileResources.refresh()
          },
          closeMobileMirror: async (mirrorId) => {
            const result = await ctx.remote.deviceCapabilities.closeMobileMirror({ mirrorId })
            if (!result.ok) throw new Error(t('mobileResourcesActionFailed'))
            mobileResources.refresh()
          },
          watchBrowserResources: browserResources.watch,
          refreshBrowserResources: browserResources.refresh,
          runBrowserResource: async (operation) => {
            const result = await (operation === 'install' ? ctx.remote.browser.installRuntime()
              : operation === 'reinstall' ? ctx.remote.browser.reinstallRuntime() : ctx.remote.browser.removeRuntime())
            if (!result.ok) throw new Error(t('browserOperationFailed'))
            browserResources.refresh()
          },
          cancelBrowserResource: async (taskId) => {
            const result = await ctx.remote.browser.cancelRuntime({ taskId })
            if (!result.ok) throw new Error(t('browserOperationFailed'))
            browserResources.refresh()
          },
          closeBrowserRuntime: async () => {
            const result = await ctx.remote.browser.closeRuntime()
            if (!result.ok) throw new Error(t('browserOperationFailed'))
            browserResources.refresh()
          },
          saveBrowserRouting: async (changes, revision) => {
            const ops = BROWSER_ROUTING_FIELDS.flatMap(({ key }) => changes[key] === undefined
              ? [] : [{ op: 'set' as const, path: [key], value: changes[key] }])
            if (!await browserRouting.mutate(ops, revision)) throw new Error(t('browserSettingsFailed'))
          },
          resetBrowserRouting: async (revision) => {
            if (!await browserRouting.mutate(BROWSER_ROUTING_FIELDS.map(({ key }) => ({ op: 'unset', path: [key] })), revision)) {
              throw new Error(t('browserSettingsFailed'))
            }
          },
          saveMobileSettings: async (value, revision) => {
            await mutatePreferences('mobile-device', mobileSettings, [
              { op: 'set', path: ['enabled'], value: value.enabled },
              { op: 'set', path: ['androidSdkPath'], value: value.androidSdkPath },
              { op: 'set', path: ['defaultDeviceId'], value: value.defaultDeviceId },
            ], revision, 'preferencesFailed')
          },
          resetMobileSettings: async (revision) => {
            await mutatePreferences('mobile-device', mobileSettings,
              ['enabled', 'androidSdkPath', 'defaultDeviceId'].map(key => ({ op: 'unset', path: [key] })), revision, 'preferencesFailed')
          },
          resetBrowserPreferences: async (revision) => {
            await mutatePreferences('browser-playwright', browserPreferences,
              BROWSER_FIELDS.map(field => ({ op: 'unset', path: [field.key] })), revision, 'browserSettingsFailed')
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
            await mutatePreferences('browser-playwright', browserPreferences,
              BROWSER_FIELDS.map(field => ({ op: 'set', path: [field.key], value: value[field.key] })), revision, 'browserSettingsFailed')
          },
        }),
      }, CapabilitySection)
    })
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
