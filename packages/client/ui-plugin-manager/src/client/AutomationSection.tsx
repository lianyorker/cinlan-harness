/** Settings switch for the automation bundle the Plugins page also switches. */
import type { ReactNode } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './AutomationSection.module.css'

/** Bundle that owns scheduled automation tasks and the Task Manager panel. */
export const AUTOMATION_BUNDLE = '@deepseek-ai/dsh-experimental-schedule-bundle'

/** Current enablement and the one write this section offers. */
export interface AutomationSectionInjected {
  hooks: { automationEnabled: ObservableSnapshot<boolean | undefined> }
  /** Request the bundle's enablement; the source republishes the accepted state. */
  setEnabled(enabled: boolean): void
}

/** Settings props: framework-bound enablement, the write, and localized copy. */
export type AutomationSectionProps = PropsLocale<'pluginManager'> & InjectFace<AutomationSectionInjected>

/**
 * Render the automation bundle's switch.
 * @param props - framework-bound enablement source, the write, and localized copy.
 * @returns the settings row; an unread inventory leaves the switch disabled.
 */
export function AutomationSection({ useAutomationEnabled, setEnabled, t }: AutomationSectionProps): ReactNode {
  const enabled = useAutomationEnabled(value => value)
  return <div className={css.setting}>
    <div className={css.text}>
      <span className={css.title}>{t('automationTitle')}</span>
      <p className={css.description}>{t('automationDescription')}</p>
    </div>
    <Switch checked={enabled === true} disabled={enabled === undefined} label={t('automationToggle')}
      title={enabled === undefined ? t('automationUnavailable') : t('automationTitle')} onChange={setEnabled} />
  </div>
}
