/** The Subagent model-selection settings page: the permission switch and its exact routes. */

import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SettingsForm } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formLabels } from './locales.ts'
import { SubagentModelSelectionFields } from './SubagentModelSelectionFields.tsx'
import type { SubagentModelSelectionCardFace } from './subagent-model-selection-card-controller.ts'

/** Props the renderer binds for the model-selection page. */
export type SubagentModelSelectionSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.subagent'>
  & InjectFace<SubagentModelSelectionCardFace>

/**
 * Render the model permission and route choices with their save footer.
 * @param props - locale copy, the staged authorization, and its actions.
 * @returns the settings form.
 */
export function SubagentModelSelectionSection(props: SubagentModelSelectionSectionProps) {
  const { t } = props
  const models = props.useSubagentModelSelectionCard(snapshot => snapshot)
  // A conflicted draft must not save: the Host moved under it, so the write
  // would fence-refuse anyway — surface it as invalid instead.
  const state = { ...models, invalid: models.invalid || (models.dirty && models.conflicted) }
  return (
    <div data-settings-anchor="subagent-model-selection">
      <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
        <SubagentModelSelectionFields t={t} state={models}
          toggleEnabled={props.toggleEnabled} toggleModel={props.toggleModel} retryCatalog={props.retryCatalog} />
      </SettingsForm>
    </div>
  )
}
