/** Shared registration helpers for capability-owned settings sections. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilityDefinition, CapabilitySectionInjected, CapabilitySectionProps } from './CapabilitySection.tsx'
import { CapabilitySection } from './CapabilitySection.tsx'
import { CAPABILITY_FIELDS } from './settings-fields.ts'
import type { ProviderActivationCallbacks } from './ProviderActivation.tsx'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'

/** Locale namespace used by the capability section renderers. */
export const CAPABILITY_LOCALE = 'settings.cinlanCapabilities' as const

/** Common Host reads shared by feature-owned capability registrations. */
export interface CapabilityRegistrationShared {
  readonly list: () => Promise<PluginInventorySnapshot>
  readonly providerActivation: ProviderActivationCallbacks
  readonly t: CapabilitySectionProps['t']
}

/**
 * Register metadata, the section slot, and its icon under one feature-owned disposer.
 * @param ctx - Settings client context that owns the registration effects.
 * @param shared - Inventory, provider activation, and locale callbacks for the feature.
 * @param definition - Capability metadata for the section.
 * @param icon - Section icon component.
 * @param inject - Factory for the section injection face.
 * @returns Disposer for the feature-owned registrations.
 */
export function registerCapabilitySection(
  ctx: ClientContext,
  shared: CapabilityRegistrationShared,
  definition: CapabilityDefinition & { readonly id: Exclude<CapabilityDefinition['id'], 'security'> },
  icon: typeof IconGlobeOutline14,
  inject: () => CapabilitySectionInjected,
): () => void {
  const section = ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: `cinlan-${definition.id}`, groupId: 'tools' })
    yield ctx.settingsMetadata.registerItems(`cinlan-${definition.id}`, [
      ...CAPABILITY_FIELDS[definition.id].map(field => ({
        id: field.title,
        anchorId: field.anchorId,
        title: () => shared.t(field.title),
        description: () => shared.t(field.description),
        keywords: () => [shared.t(definition.navKey)],
      })),
      {
        id: 'components',
        anchorId: definition.id + '-components',
        title: () => shared.t('hostFact'),
        description: () => shared.t('inventoryCaveat'),
        keywords: () => [shared.t(definition.navKey)],
      },
    ])
    yield ctx.slots.register({
      name: 'settings.section',
      id: `cinlan-${definition.id}`,
      order: definition.order,
      label: () => shared.t(definition.navKey),
      locale: CAPABILITY_LOCALE,
      inject,
    }, CapabilitySection)
  })
  const iconDisposer = ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon',
    key: `cinlan-${definition.id}`,
  }, icon))
  return () => { iconDisposer(); section() }
}
