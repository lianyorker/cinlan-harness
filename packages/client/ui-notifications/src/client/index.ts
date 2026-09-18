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
import { createNotificationSettingsActions } from './settings-actions.ts'

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
  'settingsMetadata', 'slots', 'locale', 'remote', 'remote.settings', 'settingsScope', 'sessions',
]

/**
 * Register the notification page, localized search fields, and delivery runtime.
 * @param ctx - client plugin context owning all registrations and event listeners.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-notifications: dictionaries')
  const settings: SettingsScope<NotificationSettings> = ctx.settingsScope.bind({ namespace: 'notifications' })
  const t = ctx.locale.bind(NS)
  const runtime: NotificationRuntimeFace = createNotificationRuntime(ctx, settings, {
    get completionTitle() { return t('completionTitle') },
    completionBody: sessionTitle => t('completionBody', { sessionTitle }),
    get bellTitle() { return t('bellTitle') },
    bellBody: sessionTitle => t('bellBody', { sessionTitle }),
    get testTitle() { return t('testTitle') },
    get testBody() { return t('testBody') },
  })
  ctx.effect(() => () => { runtime.dispose() }, 'ui-notifications: runtime')
  const actions = createNotificationSettingsActions(settings, runtime)
  const injected = (): NotificationsSectionInjected => ({
    hooks: { settings },
    ...actions,
    testNotification: runtime.test,
  })
  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'notifications', groupId: 'personal' })
    const items: readonly [string, string, NotificationsKey, NotificationsKey, NotificationsKey][] = [
      ['enabled', 'notifications-enabled', 'enabled', 'enabledDescription', 'enabledKeywords'],
      ['agent-completion', 'notifications-agent-completion', 'agentCompletion', 'agentCompletionDescription', 'completionKeywords'],
      ['terminal-bell', 'notifications-terminal-bell', 'terminalBell', 'terminalBellDescription', 'bellKeywords'],
      ['focus-suppression', 'notifications-focus-suppression', 'focusSuppression', 'focusSuppressionDescription', 'focusKeywords'],
      ['test', 'notifications-test', 'testTitle', 'testDescription', 'testKeywords'],
      ['quiet-hours', 'notifications-quiet-hours', 'quietHoursEnabled', 'quietHoursDescription', 'quietHoursKeywords'],
      ['quiet-start', 'notifications-quiet-start', 'quietHoursStart', 'quietHoursStartDescription', 'quietHoursKeywords'],
      ['quiet-end', 'notifications-quiet-end', 'quietHoursEnd', 'quietHoursEndDescription', 'quietHoursKeywords'],
      ['sound', 'notifications-sound', 'sound', 'soundDescription', 'soundKeywords'],
      ['custom-sound', 'notifications-custom-sound', 'customSound', 'customSoundDescription', 'soundKeywords'],
      ['reset', 'notifications-reset', 'resetTitle', 'resetDescription', 'resetKeywords'],
    ]
    yield ctx.settingsMetadata.registerItems('notifications', items.map(([id, anchorId, title, description, keywords]) => ({
      id, anchorId, title: () => t(title), description: () => t(description), keywords: () => [t(keywords)],
    })))
    yield ctx.slots.register({
      name: 'settings.section',
      id: 'notifications',
      order: 20,
      label: () => t('nav'),
      locale: NS,
      inject: injected,
    }, NotificationsSection)
  })
}
