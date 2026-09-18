/** Automation settings contribution with public-only metadata and declaration-bound lifetime. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-automation-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { IconClockOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { AutomationSettingsSection } from './AutomationSettingsSection.tsx'
import type { AutomationInjected } from './types.ts'
import { en, zh, type AutomationSettingsKey } from './locales.ts'

/** Services read only in the apply closure, never passed into components. */
export const inject = ['slots', 'locale', 'settingsMetadata', 'automationClient', 'sessions']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Automation draft, run control, and evidence labels. */
    'settings.automation': AutomationSettingsKey
  }
}

/**
 * Register the page and static search labels for exactly the Settings declaration lifetime.
 * @param ctx - locale, Settings metadata, API Client source, and Session navigation services.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('settings.automation', { en, zh }))
  const t = ctx.locale.bind('settings.automation')
  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'automation', groupId: 'experimental' })
    yield ctx.settingsMetadata.registerItems('automation', ([
      ['tasks', 'tasksHelp'], ['draft', 'draftHelp'], ['journal', 'journalHelp'],
    ] as const).map(([id, description]) => ({
      id, anchorId: id, title: () => t(id), description: () => t(description),
    })))
    yield ctx.slots.register({
      name: 'settings.section', id: 'automation', order: 130, label: () => t('title'), locale: 'settings.automation',
      inject: (): AutomationInjected => ({
        hooks: { automation: ctx.automationClient.source },
        refresh: () => ctx.automationClient.refresh(),
        create: draft => ctx.automationClient.create(draft),
        update: request => ctx.automationClient.update(request),
        deleteTask: request => ctx.automationClient.delete(request),
        run: request => ctx.automationClient.run(request),
        cancel: runId => ctx.automationClient.cancel(runId),
        loadRuns: id => ctx.automationClient.loadRuns(id),
        loadMoreRuns: () => ctx.automationClient.loadMoreRuns(),
        openSession: (id) => { ctx.sessions.open(id) },
      }),
    }, AutomationSettingsSection)
  })
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({ name: 'settings.section.icon', key: 'automation' }, IconClockOutline16))
}
