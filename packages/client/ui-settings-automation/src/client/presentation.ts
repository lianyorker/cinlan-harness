/** Pure conversions for draft editing and evidence labels. */
import type { AutomationDefinition, AutomationDraft, AutomationRunStatus, AutomationSchedule } from '@deepseek-ai/dsh-automation/types'
import type { AutomationSettingsKey } from './locales.ts'
import { assertNever } from '@deepseek-ai/dsh-util-values'

/**
 * Copy only editable definition fields; resolved authority never enters a mutation draft.
 * @param definition - saved definition at the revision being edited.
 * @returns independent editable fields.
 */
export function definitionDraft(definition: AutomationDefinition): AutomationDraft {
  const { title, prompt, workspaceId, agentPresetId, model, permissionPresetId, schedule } = definition.spec
  return { title, prompt, workspaceId, agentPresetId, model: { ...model }, permissionPresetId, schedule: { ...schedule } }
}

/**
 * Change schedule frequency while preserving its compatible time fields.
 * @param schedule - current UTC schedule.
 * @param kind - explicitly selected frequency.
 * @returns the selected UTC schedule; weekly starts with no chosen days.
 */
export function changeFrequency(schedule: AutomationSchedule, kind: AutomationSchedule['kind']): AutomationSchedule {
  const minute = schedule.minute
  const hour = schedule.kind === 'hourly' ? 0 : schedule.hour
  switch (kind) {
    case 'hourly': return { kind, minute }
    case 'daily': return { kind, minute, hour }
    case 'weekly': return { kind, minute, hour, weekdays: schedule.kind === 'weekly' ? schedule.weekdays : [] }
    default: return assertNever(kind)
  }
}

/**
 * Identify runs whose execution is not yet terminal.
 * @param status - recorded runtime state.
 * @returns whether cancellation or overlap protection still applies.
 */
export function isActive(status: AutomationRunStatus): boolean {
  return status === 'starting' || status === 'running' || status === 'stopping'
}

/**
 * Render UTC independently from browser timezone or locale defaults.
 * @param timestamp - epoch milliseconds from the runtime.
 * @returns an ISO timestamp with its UTC designator.
 */
export function utcTime(timestamp: number): string {
  return new Date(timestamp).toISOString()
}

/**
 * Map safe API error codes to localized copy without exposing arbitrary exception text.
 * @param error - rejected command error.
 * @returns locale key; unknown transport errors retain the draft and report uncertainty.
 */
export function errorKey(error: unknown): AutomationSettingsKey {
  const failure = typeof error === 'object' && error !== null && 'failure' in error ? error.failure : error
  const code = typeof failure === 'object' && failure !== null && 'code' in failure ? failure.code : undefined
  switch (code) {
    case 'conflict': return 'conflict'
    case 'invalid': return 'invalid'
    case 'busy': return 'busy'
    case 'resource': return 'resource'
    case 'storage': return 'storage'
    case 'not-found': return 'notFound'
    case 'readonly': return 'readonly'
    case 'unavailable': return 'unavailable'
    default: return 'operationFailed'
  }
}
