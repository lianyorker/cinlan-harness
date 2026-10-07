import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { IconLinkOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { CompanionSection } from './CompanionSection.tsx'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { CompanionPanel } from './CompanionPanel.tsx'

/** Register the Orca Mobile companion page in the native settings shell. */
export const companionInject = ['slots', 'settingsMetadata', 'locale']

/** Mount the companion section after the settings shell has provided its slots. */
export function applyCompanion(ctx: ClientContext): void {
  const t = ctx.locale.bind('settings.cinlanCapabilities')
  const panelId = 'cinlan-companion' as MainPanelId
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: panelId, locale: 'settings.cinlanCapabilities',
  }, CompanionPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: panelId, order: 20,
    label: () => t('companionNav'), locale: 'settings.cinlanCapabilities',
  }, IconLinkOutline16))
  const section = ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({
      sectionId: 'cinlan-companion', groupId: 'tools',
      title: () => t('companionTitle'), description: () => t('companionDescription'),
    })
    yield ctx.settingsMetadata.registerItems('cinlan-companion', [
      { id: 'companion-host-name', anchorId: 'companion-host-name', title: () => t('companionHostName'), description: () => t('companionHostNameHelp'), keywords: () => [t('companionNav')] },
      { id: 'companion-transport', anchorId: 'companion-transport', title: () => t('companionConnection'), description: () => t('companionRelayHelp'), keywords: () => [t('companionNav')] },
      { id: 'companion-pairing', anchorId: 'companion-pairing', title: () => t('companionPairPhone'), description: () => t('companionPairHelp'), keywords: () => [t('companionNav')] },
      { id: 'companion-devices', anchorId: 'companion-devices', title: () => t('companionPairedDevices'), description: () => t('companionRevokeHelp'), keywords: () => [t('companionNav')] },
    ])
    yield ctx.slots.register({ name: 'settings.section', id: 'cinlan-companion', order: 71, label: () => t('companionNav'), locale: 'settings.cinlanCapabilities' }, CompanionSection)
  })
  const icon = ctx.slots.inject('settings.section.icon', () => ctx.slots.register({ name: 'settings.section.icon', key: 'cinlan-companion' }, IconLinkOutline16))
  ctx.effect(() => () => { icon(); section() }, 'ui-settings-security: companion settings registration')
}
