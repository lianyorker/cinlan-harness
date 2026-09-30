/** Browser settings plugin: scopes, runtime observation, and explicit Browser operations. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-api-browser-controller/remote'
import type { BrowserPreferences, BrowserRuntimeTask, BrowserRuntimeTaskId } from '@deepseek-ai/dsh-browser-playwright/types'
import type { SidebarPrefs } from '@deepseek-ai/dsh-client-ui-better-sidebar/client/service'
import type { Config } from '../config.ts'
import { BROWSER_CAPABILITY, type BrowserSectionInjected } from './CapabilitySection.tsx'
import { createBrowserResourceObserver } from './browser-resources.ts'
import type { BrowserControlsCallbacks } from './BrowserControls.tsx'
import { registerCapabilitySection } from './capability-registration.ts'
import { BROWSER_FIELDS, BROWSER_ROUTING_FIELDS } from './settings-fields.ts'
import type { BrowserRoutingPreferences } from './BrowserRoutingForm.tsx'
import { createCapabilityShared, mutateCapabilityPreferences } from './capability-shared.ts'

/** Dependencies owned by the Browser registration. */
export const inject = [
  'settingsMetadata', 'slots', 'locale', 'remote', 'remote.pluginInventory',
  'remote.browser', 'remote.settings', 'settingsScope',
]

/** Register the Browser feature inside its own Cordis fiber. */
export function apply(ctx: ClientContext, config: Config): void {
  const shared = createCapabilityShared(ctx)
  const { t } = shared
  const browserPreferences = ctx.settingsScope.bind<BrowserPreferences>({ namespace: 'browser-playwright' })
  const browserRouting = ctx.settingsScope.bind<SidebarPrefs>({ namespace: 'dsh-better-sidebar' })
  const browserResources = createBrowserResourceObserver(async (signal) => {
    const result = await ctx.remote.browser.runtimeStatus(signal)
    if (!result.ok) throw new Error(t('browserOperationFailed'))
    return result.value
  }, config.runtimePollIntervalMs)
  ctx.effect(() => browserResources.dispose, 'ui-settings-security: browser runtime observations')
  ctx.on('connection/reset', () => { browserResources.refresh() })

  const saveBrowserRouting = async (changes: Partial<BrowserRoutingPreferences>, revision: number): Promise<void> => {
    const operations = BROWSER_ROUTING_FIELDS.flatMap(({ key }) => changes[key] === undefined
      ? [] : [{ op: 'set' as const, path: [key], value: changes[key] }])
    if (!await browserRouting.mutate(operations, revision)) throw new Error(t('browserSettingsFailed'))
  }
  const resetBrowserRouting = async (revision: number): Promise<void> => {
    if (!await browserRouting.mutate(BROWSER_ROUTING_FIELDS.map(({ key }) => ({ op: 'unset' as const, path: [key] })), revision)) {
      throw new Error(t('browserSettingsFailed'))
    }
  }
  const saveBrowserPreferences = (value: BrowserPreferences, revision: number): Promise<void> => mutateCapabilityPreferences(
    ctx, t, 'browser-playwright', browserPreferences,
    BROWSER_FIELDS.map(field => ({ op: 'set' as const, path: [field.key], value: value[field.key] })),
    revision, 'browserSettingsFailed',
  )
  const resetBrowserPreferences = (revision: number): Promise<void> => mutateCapabilityPreferences(
    ctx, t, 'browser-playwright', browserPreferences,
    BROWSER_FIELDS.map(field => ({ op: 'unset' as const, path: [field.key] })),
    revision, 'browserSettingsFailed',
  )
  const browserControls: BrowserControlsCallbacks = {
    snapshot: async (pageId, signal) => { const result = await ctx.remote.browser.snapshot({ pageId }, signal); if (!result.ok) throw new Error(t('browserOperationFailed')); return result.value },
    upload: async (request, signal) => { const result = await ctx.remote.browser.upload(request, signal); if (!result.ok) throw new Error(t('browserOperationFailed')); return result.value },
    downloads: async (pageId, signal) => { const result = await ctx.remote.browser.downloads({ pageId }, signal); if (!result.ok) throw new Error(t('browserOperationFailed')); return result.value },
    download: async (request, signal) => { const result = await ctx.remote.browser.download(request, signal); if (!result.ok) throw new Error(t('browserOperationFailed')); return result.value },
    pages: async (signal) => { const result = await ctx.remote.browser.pages(signal); if (!result.ok) throw new Error(t('browserOperationFailed')); return result.value },
    open: async (target, signal) => { const result = await ctx.remote.browser.open(target, signal); if (!result.ok) throw new Error(t('browserOperationFailed')); return result.value },
    history: async (pageId, signal) => { const result = await ctx.remote.browser.history({ pageId }, signal); if (!result.ok) throw new Error(t('browserOperationFailed')); return result.value },
    network: async (pageId, signal) => { const result = await ctx.remote.browser.network({ pageId }, signal); if (!result.ok) throw new Error(t('browserOperationFailed')); return result.value },
    importCookies: async (request, signal) => { const result = await ctx.remote.browser.importCookies(request, signal); if (!result.ok) throw new Error(t('browserCookieFailed')); return result.value },
  }
  const injectSection = (): BrowserSectionInjected => ({
    ...shared.providerActivation, list: shared.list, definition: BROWSER_CAPABILITY,
    hooks: { browserPreferences, browserRouting, browserResources: browserResources.store },
    watchBrowserResources: browserResources.watch, refreshBrowserResources: browserResources.refresh,
    runBrowserResource: async (operation: BrowserRuntimeTask['operation']) => {
      const result = await (operation === 'install' ? ctx.remote.browser.installRuntime()
        : operation === 'reinstall' ? ctx.remote.browser.reinstallRuntime() : ctx.remote.browser.removeRuntime())
      if (!result.ok) throw new Error(t('browserOperationFailed'))
      browserResources.refresh()
    },
    cancelBrowserResource: async (taskId: BrowserRuntimeTaskId) => {
      const result = await ctx.remote.browser.cancelRuntime({ taskId })
      if (!result.ok) throw new Error(t('browserOperationFailed'))
      browserResources.refresh()
    },
    closeBrowserRuntime: async () => {
      const result = await ctx.remote.browser.closeRuntime()
      if (!result.ok) throw new Error(t('browserOperationFailed'))
      browserResources.refresh()
    },
    saveBrowserRouting, resetBrowserRouting, saveBrowserPreferences, resetBrowserPreferences, browserControls,
  })
  registerCapabilitySection(ctx, shared, BROWSER_CAPABILITY, IconGlobeOutline14, injectSection)
}
