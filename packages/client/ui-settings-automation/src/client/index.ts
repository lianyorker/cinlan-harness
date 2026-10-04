/** Automation settings contribution with public-only metadata and declaration-bound lifetime. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-automation-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { IconClockOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { AutomationPanel, AutomationSettingsLauncher } from './AutomationPanel.tsx'
import type { AutomationInjected } from './types.ts'
import { en, zh, type AutomationSettingsKey } from './locales.ts'

/** Services read only in the apply closure, never passed into components. */
export const inject = ['slots', 'locale', 'settingsMetadata', 'automationClient', 'layout', 'uiWorkspace']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Automation draft, run control, and evidence labels. */
    'settings.automation': AutomationSettingsKey
  }
}

/** Configuration options for automation UI contribution. */
export interface Config {
  /**
   * Whether to contribute a section launcher to the Settings view.
   * Defaults to true. When false, the main panel and sidebar item remain accessible,
   * but no entry is shown in Settings.
   */
  settingsSection?: boolean
}

/**
 * Register the page and static search labels for exactly the Settings declaration lifetime.
 * @param ctx - locale, Settings metadata, API Client source, and workspace navigation services.
 * @param config - optional plugin configuration.
 */
export function apply(ctx: Context, config?: Config): void {
  ctx.effect(() => ctx.locale.register('settings.automation', { en, zh }))
  const t = ctx.locale.bind('settings.automation')
  const panelId = 'automation' as MainPanelId
  const close = () => { ctx.layout.selectPanel('conversation' as MainPanelId) }
  const injected = (): AutomationInjected => ({
    hooks: { automation: ctx.automationClient.source },
    refresh: () => ctx.automationClient.refresh(),
    create: draft => ctx.automationClient.create(draft),
    update: request => ctx.automationClient.update(request),
    deleteTask: request => ctx.automationClient.delete(request),
    run: request => ctx.automationClient.run(request),
    cancel: runId => ctx.automationClient.cancel(runId),
    loadRuns: id => ctx.automationClient.loadRuns(id),
    loadMoreRuns: () => ctx.automationClient.loadMoreRuns(),
    openSession: (id) => {
      ctx.uiWorkspace.openSession(id)
      close()
    },
  })
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: panelId, locale: 'settings.automation', inject: () => ({ ...injected(), close }),
  }, AutomationPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: panelId, order: 10, label: () => t('title'), locale: 'settings.automation',
  }, IconClockOutline16))
  if (config?.settingsSection !== false) {
    ctx.slots.inject('settings.section', function* () {
      yield ctx.settingsMetadata.registerSection({ sectionId: 'automation', groupId: 'execution' })
      yield ctx.settingsMetadata.registerItems('automation', ([
        ['tasks', 'tasksHelp'], ['draft', 'draftHelp'], ['journal', 'journalHelp'],
      ] as const).map(([id, description]) => ({
        id, anchorId: id, title: () => t(id), description: () => t(description),
      })))
      yield ctx.slots.register({
        name: 'settings.section', id: 'automation', order: 130, label: () => t('title'), locale: 'settings.automation',
        inject: () => ({ openAutomation: () => { ctx.layout.selectPanel(panelId) } }),
      }, AutomationSettingsLauncher)
    })
    ctx.slots.inject('settings.section.icon', () => ctx.slots.register({ name: 'settings.section.icon', key: 'automation' }, IconClockOutline16))
  }
}
