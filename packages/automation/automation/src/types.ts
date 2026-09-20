/** Durable automation definitions, occurrence receipts, and public commands. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { UserMessage, LlmReasoningEffortInfo } from '@deepseek-ai/dsh-llm/types'

/** Durable task identity, scoped to the canonical launch profile. */
export type AutomationId = Branded<'AutomationId'>
/** Durable invocation identity, independent from the resulting Session. */
export type AutomationRunId = Branded<'AutomationRunId'>
/** Client-generated token retained for idempotent manual Run admission. */
export type AutomationRequestId = Branded<'AutomationRequestId'>
/** Minute-precision UTC calendar schedules. Weekdays use Sunday = 0. */
export type AutomationSchedule =
  | { readonly kind: 'hourly'; readonly minute: number }
  | { readonly kind: 'daily'; readonly hour: number; readonly minute: number }
  | { readonly kind: 'weekly'; readonly weekdays: readonly number[]; readonly hour: number; readonly minute: number }
/** Persisted model choice, detached from the mutable Agent selection controller. */
export interface AutomationModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: LlmReasoningEffortInfo['id']
}
/** Pinned execution authority; changes require a fresh explicit save. */
export interface AutomationPermission {
  readonly sandbox: 'read-only' | 'workspace-write' | 'danger-full-access'
  readonly approval: 'ask' | 'never'
}
/** Explicit editable inputs; creation never accepts an enabled flag. */
export interface AutomationDraft {
  readonly title: string
  readonly prompt: string
  readonly workspaceId: WorkspaceId
  readonly agentPresetId: string
  readonly model: AutomationModelSelection
  readonly permissionPresetId: string
  readonly schedule: AutomationSchedule
}
/** Host-resolved authority and immutable workspace identity. */
export interface AutomationSpec extends AutomationDraft {
  readonly workspacePath: string
  readonly permission: AutomationPermission
}
/** Saved plan and its forward-only scheduling cursor. */
export interface AutomationDefinition {
  readonly id: AutomationId
  readonly revision: number
  readonly scheduleRevision: number
  readonly spec: AutomationSpec
  readonly enabled: boolean
  readonly needsReview: boolean
  readonly nextPlannedAt: number | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly deletedAt: number | null
}
/** Evidence-backed invocation states. Ambiguous/interrupted never auto-retry. */
export type AutomationRunStatus = 'starting' | 'running' | 'stopping' | 'completed' | 'failed' | 'cancelled' | 'skipped-overlap' | 'interrupted' | 'ambiguous'
/** Immutable admitted input and its committed lifecycle evidence. */
export interface AutomationRun {
  readonly id: AutomationRunId
  readonly automationId: AutomationId
  readonly definitionRevision: number
  readonly scheduleRevision: number
  readonly spec: AutomationSpec
  readonly trigger: 'scheduled' | 'manual'
  readonly requestId: AutomationRequestId | null
  readonly plannedAt: number
  readonly sessionId: SessionId | null
  readonly messageId: UserMessage['id'] | null
  readonly turn: number | null
  readonly status: AutomationRunStatus
  readonly reason: string | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly finishedAt: number | null
}
/** A successful snapshot distinguishes an empty plan list from unavailability. */
export type AutomationSnapshot =
  | { readonly status: 'unavailable'; readonly profile: string; readonly reason: 'owned' | 'storage' | 'closing' }
  | { readonly status: 'ready'; readonly profile: string; readonly revision: number; readonly definitions: readonly AutomationDefinition[]; readonly activeRuns: readonly AutomationRun[] }
/** Complete replacement fenced by the revision from the first edit. */
export interface AutomationUpdate {
  readonly id: AutomationId
  readonly expectedRevision: number
  readonly draft: AutomationDraft
  readonly enabled: boolean
}
/** Delete is refused while the definition has an active invocation. */
export interface AutomationDelete { readonly id: AutomationId; readonly expectedRevision: number }
/** Explicit manual invocation; retries must retain requestId. */
export interface AutomationRunRequest extends AutomationDelete { readonly requestId: AutomationRequestId }
/** Bounded journal page in newest-first order. */
export interface AutomationRunPage { readonly runs: readonly AutomationRun[]; readonly nextCursor: AutomationRunId | null }
/** Stable business errors, with no credential or provider response content. */
export type AutomationErrorCode = 'unavailable' | 'not-found' | 'conflict' | 'invalid' | 'busy' | 'resource' | 'storage'
/** Validated deployment policy; no recurrence or ownership depends on process cwd. */
export interface AutomationConfig {
  /** Launcher profile identity owning this automation store and scheduler. */
  readonly profile: string
  /** Maximum milliseconds between scheduler clock checks. */
  readonly clockCheckIntervalMs: number
  /** Lateness in milliseconds at which a scheduled invocation is skipped. */
  readonly maxStartLatenessMs: number
}
