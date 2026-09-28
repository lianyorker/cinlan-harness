/** Shared callbacks for feature-owned capability settings registrations. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { PluginInventorySnapshot, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CapabilitySectionInjected, CapabilitySectionProps, ComputerSectionInjected, MobileSectionInjected } from './CapabilitySection.tsx'
import type { ProviderActivationCallbacks } from './ProviderActivation.tsx'

/** Common settings reads needed by every non-security capability page. */
export interface CapabilityShared extends Pick<CapabilitySectionInjected, 'list'> {
  readonly providerActivation: ProviderActivationCallbacks
  readonly t: CapabilitySectionProps['t']
}

/**
 * Build inventory, provider-management, and locale callbacks inside one feature fiber.
 * @param ctx - Settings client context that supplies the Host services.
 * @returns Feature-local inventory, provider activation, and locale callbacks.
 */
export function createCapabilityShared(ctx: ClientContext): CapabilityShared {
  const t = ctx.locale.bind('settings.cinlanCapabilities')
  const list: CapabilitySectionInjected['list'] = async (): Promise<PluginInventorySnapshot> => {
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
  return { list, providerActivation, t }
}

/**
 * Persist a revision-fenced settings mutation after checking the active Host scope.
 * @param ctx - Settings client context that owns the mutation.
 * @param t - Feature-local locale lookup.
 * @param namespace - Settings namespace to mutate.
 * @param scope - Bound settings scope whose writable state is checked.
 * @param operations - Path operations sent to the Host.
 * @param revision - Revision read when the draft opened.
 * @param errorKey - Locale key for a rejected mutation.
 */
export async function mutateCapabilityPreferences(
  ctx: ClientContext,
  t: CapabilitySectionProps['t'],
  namespace: string,
  scope: SettingsScope<unknown>,
  operations: readonly SettingsPathOpView[],
  revision: number,
  errorKey: 'browserSettingsFailed' | 'preferencesFailed',
): Promise<void> {
  const current = scope.getSnapshot()
  if (current.status !== 'ready' || !current.writable || current.mode !== 'host') throw new Error(t('preferencesReadOnly'))
  const result = await ctx.remote.settings.mutate(namespace, [...operations], revision)
  if (!result.ok) throw new Error(t(errorKey))
  ctx.settingsScope.describe().acceptView(result.value)
}

/**
 * Probe one device provider through the generated Host Remote.
 * @param ctx - Settings client context that owns the Remote.
 * @param t - Feature-local locale lookup.
 * @returns Device readiness probe for the settings section.
 */
export function createDeviceProbe(ctx: ClientContext, t: CapabilitySectionProps['t']): ComputerSectionInjected['checkDevice'] {
  return async (capability, signal) => {
    const result = await ctx.remote.deviceCapabilities.check({ capability }, signal)
    if (!result.ok) throw new Error(t('deviceCheckFailed'))
    return result.value
  }
}

/**
 * Probe mobile SDK availability through the generated Host Remote.
 * @param ctx - Settings client context that owns the Remote.
 * @param t - Feature-local locale lookup.
 * @returns Mobile SDK readiness probe for the settings section.
 */
export function createSdkProbe(ctx: ClientContext, t: CapabilitySectionProps['t']): MobileSectionInjected['checkSdk'] {
  return async (signal) => {
    const result = await ctx.remote.deviceCapabilities.checkSdk(signal)
    if (!result.ok) throw new Error(t('mobileSdkFailed'))
    return result.value
  }
}

/**
 * Read redacted mobile devices through the generated Host Remote.
 * @param ctx - Settings client context that owns the Remote.
 * @param t - Feature-local locale lookup.
 * @returns Mobile device listing callback for the settings section.
 */
export function createMobileDeviceList(ctx: ClientContext, t: CapabilitySectionProps['t']): MobileSectionInjected['listMobileDevices'] {
  return async (signal) => {
    const result = await ctx.remote.deviceCapabilities.listMobileDevices(signal)
    if (!result.ok) throw new Error(t('mobileDevicesFailed'))
    return result.value
  }
}
