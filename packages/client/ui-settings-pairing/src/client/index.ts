/** Trusted Desktop-only phone pairing settings contribution. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { IconCodeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { PairingSection } from './PairingSection.tsx'
import { observePairing } from './observation.ts'
import { en, zh, type PairingKey } from './locales.ts'
import type { PairingInjected } from './types.ts'

/** Generated pairing operations and existing Session data are required. */
export const inject = ['slots', 'locale', 'settingsMetadata', 'remote', 'remote.pairing', 'sessions']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Trusted device pairing labels and explicit grant controls. */
    'settings.pairing': PairingKey
  }
}

/**
 * Register an independent Settings page only on a local-owner carrier.
 * @param ctx - trusted Desktop Client context with generated Remote assembly.
 */
export function apply(ctx: Context): void {
  if (!ctx.remote.$host.isLoopback) return
  ctx.effect(() => ctx.locale.register('settings.pairing', { en, zh }))
  const t = ctx.locale.bind('settings.pairing')
  const observation = observePairing(ctx.remote.pairing)
  ctx.effect(() => observation.dispose)
  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'phone-pairing', groupId: 'personal' })
    yield ctx.settingsMetadata.registerItems('phone-pairing', (['listener', 'invitation', 'devices'] as const).map(id => ({
      id, anchorId: id, title: () => t(id), description: () => t('description'), keywords: () => [t('searchTerms')],
    })))
    yield ctx.slots.register({
      name: 'settings.section', id: 'phone-pairing', order: 35, label: () => t('title'), locale: 'settings.pairing',
      inject: (): PairingInjected => ({
        hooks: { pairing: observation.source, pairingSessions: ctx.sessions.list },
        refresh: observation.refresh, enable: observation.enable, disable: observation.disable,
        createInvitation: observation.createInvitation, cancelInvitation: observation.cancelInvitation,
        revokeDevice: observation.revokeDevice,
      }),
    }, PairingSection)
  })
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon', key: 'phone-pairing',
  }, IconCodeOutline16))
}
