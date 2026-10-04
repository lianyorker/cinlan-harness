/** The Subagent delegation-limits settings page: recursion depth and live capacity. */

import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SettingsForm } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formLabels } from './locales.ts'
import { SubagentLimitsFields } from './SubagentLimitsFields.tsx'
import type { SubagentLimitsCardFace } from './subagent-limits-card-controller.ts'

/** Props the renderer binds for the limits page. */
export type SubagentLimitsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.subagent'>
  & InjectFace<SubagentLimitsCardFace>

/**
 * Render the delegation limits with their save footer.
 * @param props - locale copy, the staged limits, and their actions.
 * @returns the settings form.
 */
export function SubagentLimitsSection(props: SubagentLimitsSectionProps) {
  const { t } = props
  const state = props.useSubagentLimitsCard(snapshot => snapshot)
  return (
    <div data-settings-anchor="subagent-limits">
      <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
        <SubagentLimitsFields t={t} state={state} edit={props.edit} resetField={props.resetField} />
      </SettingsForm>
    </div>
  )
}
