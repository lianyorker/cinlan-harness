/** Notifications settings page and browser delivery plugin. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { NotificationSettings } from '@deepseek-ai/dsh-notifications/types'
import { NotificationsSection, type NotificationsSectionInjected } from './NotificationsSection.tsx'
import { createNotificationRuntime, type NotificationRuntimeFace } from './runtime.ts'
import { en, zh, type NotificationsKey } from './locales.ts'

export type { NotificationsSectionInjected, NotificationsSectionProps } from './NotificationsSection.tsx'
export type { NotificationPayload, NotificationRuntimeCopy, NotificationRuntimeFace } from './runtime.ts'
export type { NotificationsKey } from './locales.ts'

/** Client locale namespace for the Notifications page. */
const NS = 'settings.notifications'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Notifications Settings copy. */
    'settings.notifications': NotificationsKey
  }
}

/** Services required by the section registration and completion listener. */
export const inject = [
  'slots', 'locale', 'remote', 'remote.settings', 'settingsScope', 'sessions',
]

/** Register the Notifications Settings page and completion notification runtime. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-notifications: dictionaries')
  const settings: SettingsScope<NotificationSettings> = ctx.settingsScope.bind({ namespace: 'notifications' })
  const t = ctx.locale.bind(NS)
  const runtime: NotificationRuntimeFace = createNotificationRuntime(ctx, settings, {
    completionTitle: t('completionTitle'),
    completionBody: sessionTitle => t('completionBody', { sessionTitle }),
    bellTitle: t('bellTitle'),
    bellBody: sessionTitle => t('bellBody', { sessionTitle }),
    testTitle: t('testTitle'),
    testBody: t('testBody'),
  })
  ctx.effect(() => () => { runtime.dispose() }, 'ui-notifications: runtime')
  const injected = (): NotificationsSectionInjected => ({ settings, runtime })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'notifications',
    order: 20,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, NotificationsSection))
}
