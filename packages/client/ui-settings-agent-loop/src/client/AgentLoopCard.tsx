/** The agent loop's settings page: how many tool calls one step may run at once. */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SettingsForm, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formLabels } from './locales.ts'
import type { AgentLoopCardFace } from './agent-loop-card-controller.ts'

/** Props the renderer binds for the agent-loop page. */
export type AgentLoopCardProps =
  (PropsRuntime<'plugins.item'> | PropsRuntime<'settings.section'>)
  & PropsLocale<'settings.agentLoop'>
  & InjectFace<AgentLoopCardFace>
  & { readonly view?: 'summary' | 'page' }

/**
 * Render the agent loop's one-liner or its settings form, as the Plugins page asks.
 * @param props - the view asked for, locale copy, the form snapshot, and its actions.
 * @returns the one-liner, or the form.
 */
export function AgentLoopCard(props: AgentLoopCardProps) {
  const { t } = props
  const state = props.useAgentLoopCard(snapshot => snapshot)
  if (props.view === 'summary') return t('description')
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <SettingsValueField
        id="plugin-config-agent-loop-parallel"
        label={t('maxParallel')}
        hint={t('maxParallelHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={!state.writable}
        {...state.maxParallelToolCalls}
        onEdit={(text) => { props.edit('maxParallelToolCalls', text) }}
        onReset={() => { props.resetField('maxParallelToolCalls') }}
      />
    </SettingsForm>
  )
}

/**
 * Render the existing form at its product settings destination.
 * @param props - Settings owner, locale, and the existing form controller face.
 * @returns the native form with its search anchor.
 */
export function AgentLoopSettingsSection(props: PropsRuntime<'settings.section'>
  & PropsLocale<'settings.agentLoop'> & InjectFace<AgentLoopCardFace>) {
  return <div data-settings-anchor="agent-loop-settings"><AgentLoopCard {...props} view="page" /></div>
}
