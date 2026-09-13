/** Branded identifiers used by the task-coordination capability. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one coordination run. */
export type RunId = Branded<'CoordinationRunId'>

/** Identifies one task in a coordination run. */
export type TaskId = Branded<'CoordinationTaskId'>

/**
 * Brand a string as a run id.
 * @param id - raw run identifier.
 * @returns the input branded as a run identifier.
 */
export function RunId(id: string): RunId {
  return id as RunId
}

/**
 * Brand a string as a task id.
 * @param id - raw task identifier.
 * @returns the input branded as a task identifier.
 */
export function TaskId(id: string): TaskId {
  return id as TaskId
}
