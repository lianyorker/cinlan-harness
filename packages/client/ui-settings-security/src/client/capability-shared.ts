/** Shared callbacks for feature-owned capability settings registrations. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ChangeResult, PluginEntryId, PluginInfo, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-device-capabilities-controller/remote'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CapabilitySectionProps, MobileSectionInjected } from './CapabilitySection.tsx'

/** Authoritative plugin-management inventory, including entries the profile patch cannot address. */
export type ProviderInventory = { readonly kind: 'ready'; readonly entries: readonly PluginInfo[] } | { readonly kind: 'unavailable' | 'rejected' }
/** Management transport refusal remains distinct from the Host application result. */
export type ProviderChange = { readonly kind: 'result'; readonly result: ChangeResult } | { readonly kind: 'unavailable' | 'rejected' }
/** Plain callbacks to the optional Plugin Manager namespace. */
export interface ProviderActivationCallbacks {
  /** Read the entries the Host can manage. */
  listProviderEntries: () => Promise<ProviderInventory>
  /** Switch one exact entry and report the Host application result. */
  setProviderEnabled: (entryId: PluginEntryId, enabled: boolean) => Promise<ProviderChange>
}

/** Common settings reads needed by the capability page. */
export interface CapabilityShared {
  readonly providerActivation: ProviderActivationCallbacks
  readonly t: CapabilitySectionProps['t']
}

/**
 * Build provider-management and locale callbacks inside one feature fiber.
 * @param ctx - Settings client context that supplies the Host services.
 * @returns Feature-local provider activation and locale callbacks.
 */
export function createCapabilityShared(ctx: ClientContext): CapabilityShared {
  const t = ctx.locale.bind('settings.cinlanCapabilities')
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
  return { providerActivation, t }
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
export function createDeviceProbe(ctx: ClientContext, t: CapabilitySectionProps['t']): MobileSectionInjected['checkDevice'] {
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
