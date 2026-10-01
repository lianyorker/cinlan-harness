/** Independent automation workspace and its Settings entry. */
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { AutomationSettingsSection } from './AutomationSettingsSection.tsx'
import type { AutomationInjected } from './types.ts'
import css from './AutomationSettings.module.css'

type PanelProps = PropsRuntime<'main'> & PropsLocale<'settings.automation'>
  & InjectFace<AutomationInjected & { close: () => void }>

/**
 * Render tasks and execution history in the main application panel.
 * @param props - Automation API callbacks, source hooks, and conversation navigation.
 * @returns the scrolling automation workspace.
 */
export function AutomationPanel(props: PanelProps) {
  return <main className={css.panel}><AutomationSettingsSection {...props} /></main>
}

type LauncherProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.automation'>
  & InjectFace<{ openAutomation: () => void }>

/**
 * Explain scheduling and link to its management workspace.
 * @param props - Settings close callback, locale, and panel selection.
 * @returns searchable entry points without starting a task.
 */
export function AutomationSettingsLauncher({ t, close, openAutomation }: LauncherProps) {
  const open = () => { openAutomation(); close() }
  return <section className={css.section}>
    <header className={css.heading}><h1>{t('title')}</h1><p>{t('description')}</p></header>
    <p className={css.notice}>{t('scheduleLimits')}</p>
    {(['tasks', 'draft', 'journal'] as const).map(id => <section key={id} className={css.group} data-settings-anchor={id}>
      <h2>{t(id)}</h2><p className={css.help}>{t(id === 'tasks' ? 'tasksHelp' : id === 'draft' ? 'draftHelp' : 'journalHelp')}</p>
      <div className={css.actions}><Button onClick={open}>{t('openAutomation')}</Button></div>
    </section>)}
  </section>
}
