/**
 * Declarative domain model, branded IDs, presentation metadata, correlation, and service contracts for Task Surface.
 * @module @deepseek-ai/dsh-task-surface/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Branded identifier for one Task Surface instance. */
export type TaskSurfaceId = Branded<'TaskSurfaceId'>
/** Create a branded TaskSurfaceId. */
export function TaskSurfaceId(value: string): TaskSurfaceId {
  return brandString<TaskSurfaceId>(value)
}

/** Branded identifier for an idempotent submission attempt. */
export type TaskSurfaceSubmissionId = Branded<'TaskSurfaceSubmissionId'>
/** Create a branded TaskSurfaceSubmissionId. */
export function TaskSurfaceSubmissionId(value: string): TaskSurfaceSubmissionId {
  return brandString<TaskSurfaceSubmissionId>(value)
}

/** Branded identifier for an idempotent dismissal attempt. */
export type TaskSurfaceDismissalId = Branded<'TaskSurfaceDismissalId'>
/** Create a branded TaskSurfaceDismissalId. */
export function TaskSurfaceDismissalId(value: string): TaskSurfaceDismissalId {
  return brandString<TaskSurfaceDismissalId>(value)
}

/** Layout specification for a section. */
export type TaskSurfaceLayout =
  | { kind: 'stack' }
  | { kind: 'grid'; columns: 2 | 3 }

/** Discrete content block rendered in a section. */
export type TaskSurfaceBlock =
  | { kind: 'markdown'; text: string }
  | { kind: 'metrics'; items: { label: string; value: string; detail?: string }[] }
  | { kind: 'table'; columns: { id: string; label: string }[]; rows: Record<string, string | number | boolean | null>[] }
  | { kind: 'diff'; path?: string; before: string | null; after: string; language?: string }
  | { kind: 'notice'; tone: 'neutral' | 'info' | 'warning'; text: string }

/** Selectable option in choice or order fields. */
export type TaskSurfaceOption = {
  readonly id: string
  readonly label: string
  readonly detail?: string
}

/** Input field declared in the surface model. */
export type TaskSurfaceField =
  | { kind: 'text'; id: string; label: string; multiline?: boolean; required?: boolean; initial?: string }
  | { kind: 'choice'; id: string; label: string; options: TaskSurfaceOption[]; initial?: string }
  | { kind: 'multi-choice'; id: string; label: string; options: TaskSurfaceOption[]; initial?: string[] }
  | { kind: 'toggle'; id: string; label: string; initial?: boolean }
  | { kind: 'order'; id: string; label: string; options: TaskSurfaceOption[]; initial?: string[] }

/** Section grouping blocks and layout. */
export type TaskSurfaceSection = {
  readonly id: string
  readonly title?: string
  readonly layout?: TaskSurfaceLayout
  readonly blocks: TaskSurfaceBlock[]
}

/** Version 1 declarative Task Surface model. */
export type TaskSurfaceModelV1 = {
  readonly version: 1
  readonly title: string
  readonly description?: string
  readonly sections: TaskSurfaceSection[]
  readonly fields?: TaskSurfaceField[]
  readonly submit: { readonly label: string }
}

/** Tagged presentation metadata persisted with tool/result.meta. */
export type TaskSurfacePresentationMeta = {
  readonly kind: 'dsh/task-surface'
  readonly version: 1
  readonly surfaceId: TaskSurfaceId
  readonly model: TaskSurfaceModelV1
}

/** Structured correlation attached to the admitted user message source. */
export type TaskSurfaceCorrelation = {
  readonly version: 1
  readonly submissionId: TaskSurfaceSubmissionId
  readonly callId: ToolCallId
  readonly surfaceId: TaskSurfaceId
  readonly values: Record<string, unknown>
}

/** User message source carrying Task Surface correlation. */
export type TaskSurfaceUserMessageSource = {
  readonly kind: 'user'
  readonly rpcId?: string
  readonly taskSurface: TaskSurfaceCorrelation
}

/** Process-local lifecycle phase for an in-flight submission. */
export type TaskSurfaceSubmissionPhase = 'queued' | 'claiming'

/** Coordination record for a pending submission. */
export type TaskSurfacePendingSubmission = {
  readonly submissionId: TaskSurfaceSubmissionId
  readonly messageId: MessageId
  readonly phase: TaskSurfaceSubmissionPhase
}

/** Request to submit values to an active Task Surface. */
export interface SubmitTaskSurfaceRequest {
  readonly sessionId: SessionId
  readonly surfaceId: TaskSurfaceId
  readonly submissionId: TaskSurfaceSubmissionId
  readonly values: Record<string, unknown>
  readonly note?: string
}

/** Result of a submission request. */
export type SubmitTaskSurfaceResult =
  | { readonly accepted: true; readonly messageId: MessageId; readonly phase: 'queued' }
  | { readonly accepted: false; readonly reason: 'not-open' | 'stale' | 'invalid-submission' | 'submission-pending' }

/** Request to dismiss an active Task Surface without submitting. */
export interface DismissTaskSurfaceRequest {
  readonly sessionId: SessionId
  readonly surfaceId: TaskSurfaceId
  readonly dismissalId: TaskSurfaceDismissalId
}

/** Result of a dismissal request. */
export type DismissTaskSurfaceResult =
  | { readonly dismissed: true; readonly eventSeq: number }
  | { readonly dismissed: false; readonly reason: 'not-open' | 'stale' | 'submission-pending' }

/** Result of querying the active surface in a session. */
export type GetActiveTaskSurfaceResult =
  | {
    readonly active: true
    readonly callId: ToolCallId
    readonly surfaceId: TaskSurfaceId
    readonly model: TaskSurfaceModelV1
    readonly pending: TaskSurfacePendingSubmission | null
  }
  | { readonly active: false; readonly reason: 'not-open' }

/** Host-side Task Surface service seam. */
export interface TaskSurfaceService {
  /**
   * Query the currently active Task Surface and its pending state.
   * @param input - the session to query, optionally narrowed to one surface id.
   * @returns the active surface with its pending submission, or `not-open`.
   */
  getActive(input: { readonly sessionId: SessionId; readonly surfaceId?: TaskSurfaceId }): Promise<GetActiveTaskSurfaceResult>
  /**
   * Submit field values for the active surface, enqueuing a user message.
   * @param input - session, surface, idempotent submission identity, and field values.
   * @returns acceptance with the queued message id and phase, or the rejection reason.
   */
  submit(input: SubmitTaskSurfaceRequest): Promise<SubmitTaskSurfaceResult>
  /**
   * Dismiss the active surface without submission.
   * @param input - session, surface, and idempotent dismissal identity.
   * @returns dismissal with the committing event sequence, or the rejection reason.
   */
  dismiss(input: DismissTaskSurfaceRequest): Promise<DismissTaskSurfaceResult>
}

/** Active surface state projected from the session log. */
export type TaskSurfaceProjection = {
  readonly active: { readonly callId: ToolCallId; readonly surfaceId: TaskSurfaceId } | null
}

/** Limits bounding Task Surface models and submissions. */
export type TaskSurfaceLimits = {
  readonly maxModelBytes?: number
  readonly maxBlocks?: number
  readonly maxFields?: number
  readonly maxTableRows?: number
  readonly maxSubmissionBytes?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    taskSurface: TaskSurfaceService
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A session dismissed its active Task Surface without submitting. The
     * payload names the dismissed `surfaceId` and the idempotent `dismissalId`
     * attempt; the projection clears the active surface only when `surfaceId`
     * matches, so a stale dismissal for another surface changes nothing.
     */
    'task-surface/dismissed': {
      surfaceId: TaskSurfaceId
      dismissalId: TaskSurfaceDismissalId
    }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    taskSurface: TaskSurfaceProjection
  }
  interface SessionProjectionMap {
    taskSurface: TaskSurfaceProjection
  }
}
