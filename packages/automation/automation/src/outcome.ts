/** Exact automation prompt-turn correlation over existing Session events. */
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import type { AutomationRun, AutomationRunStatus } from './types.ts'

/** Read only the turn that claimed this run's identified prompt.
 * @param run - durable correlation ids and any observed claimed turn.
 * @param events - live or read-only persisted Session events.
 * @returns the owned turn's recorded ending, never whole-Agent idle inference.
 */
export function runOutcome(run: AutomationRun, events: readonly SessionEvent[]): TurnEndReason | undefined {
  let openTurn: number | undefined
  let ownedTurn = run.turn ?? undefined
  for (const event of events) {
    if (event.type === 'turn/start') openTurn = event.data.turn
    if (event.type === 'user/message' && event.data.id === run.messageId) ownedTurn = openTurn
    if (event.type === 'turn/end' && event.data.turn === ownedTurn) return event.data.reason
  }
  return undefined
}

/** Classify the actual loop ending without equating it to business-task success.
 * @param reason - exact recorded loop reason.
 * @returns the journal's terminal status.
 */
export function outcomeStatus(reason: TurnEndReason): AutomationRunStatus {
  switch (reason.kind) {
    case 'completed': return 'completed'
    case 'aborted': return 'cancelled'
    case 'interrupted': return 'interrupted'
    default: return 'failed' // Plugin-defined turn endings retain their reason but do not imply success.
  }
}
