/** Settings entry point for the official Schedule task manager. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { IconClockOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { AutomationSettingsLauncher } from './client/AutomationPanel.tsx'
import { en, zh, type AutomationSettingsKey } from './client/locales.ts'

/** Browser services used by the Settings navigation contribution. */
export const inject = ['slots', 'locale', 'settingsMetadata', 'layout']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Official Schedule entry-point labels. */
    'settings.automation': AutomationSettingsKey
  }
}

/** Register the Settings entry that opens the official Schedule manager. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('settings.automation', { en, zh }))
  const t = ctx.locale.bind('settings.automation')
  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'schedule', groupId: 'execution' })
    yield ctx.settingsMetadata.registerItems('schedule', [
      { id: 'tasks', anchorId: 'tasks', title: () => t('tasks'), description: () => t('tasksHelp') },
    ])
    yield ctx.slots.register({
      name: 'settings.section', id: 'schedule', order: 130, label: () => t('title'), locale: 'settings.automation',
      inject: () => ({ openAutomation: () => { ctx.layout.selectPanel('schedule' as never) }, close: () => {} }),
    }, AutomationSettingsLauncher)
  })
  ctx.slots.inject('settings.section.icon', () => ctx.slots.register({ name: 'settings.section.icon', key: 'schedule' }, IconClockOutline16))
}
