/** JSON requests, selection metadata, and observable automation state. */
import type {
  AutomationDraft, AutomationErrorCode, AutomationId, AutomationRun, AutomationRunId,
  AutomationSchedule, AutomationSnapshot, AutomationSpec,
} from '@deepseek-ai/dsh-automation/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

export type * from '@deepseek-ai/dsh-automation/types'

/** Cancel an admitted invocation, not its recurring definition. */
export interface AutomationCancelRequest { readonly runId: AutomationRunId }
/** Bounded newest-first journal request; null starts a fresh page. */
export interface AutomationRunsRequest {
  readonly id: AutomationId
  readonly cursor: AutomationRunId | null
  readonly limit: number
}
/** Five occurrences strictly after an absolute UTC timestamp. */
export interface AutomationPreviewRequest {
  readonly schedule: AutomationSchedule
  readonly afterUtc: number
}
/** Every frame replaces the whole committed runtime view. */
export type AutomationFollowFrame =
  | { readonly type: 'baseline'; readonly value: AutomationSnapshot }
  | { readonly type: 'snapshot'; readonly value: AutomationSnapshot }
/** Stable reason tokens; source names and descriptions are untranslated data. */
export type AutomationChoiceAvailability = 'ready' | 'missing' | 'unavailable' | 'broken' | 'unlisted'
/** An existing workspace with live directory status. */
export interface AutomationWorkspaceChoice {
  readonly id: WorkspaceId
  readonly title: string
  readonly path: string
  readonly availability: AutomationChoiceAvailability
}
/** An agent preset, including a missing configured default. */
export interface AutomationPresetChoice {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly availability: AutomationChoiceAvailability
}
/** Advisory model metadata; unlisted does not prohibit explicit routing. */
export interface AutomationModelChoice {
  readonly provider: string
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly availability: AutomationChoiceAvailability
}
/** Registered provider and the outcome of reading its advisory model list. */
export interface AutomationProviderChoice {
  readonly id: string
  readonly name: string
  readonly availability: AutomationChoiceAvailability
}
/** Permission policy values stay explicit; creation never guesses a preset. */
export interface AutomationPermissionChoice {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly availability: AutomationChoiceAvailability
  readonly permission: AutomationSpec['permission'] | null
}
/** Selector data from the current Host services, without provider test calls. */
export interface AutomationCatalog {
  readonly workspaces: readonly AutomationWorkspaceChoice[]
  readonly agentPresets: readonly AutomationPresetChoice[]
  readonly providers: readonly AutomationProviderChoice[]
  readonly models: readonly AutomationModelChoice[]
  readonly permissionPresets: readonly AutomationPermissionChoice[]
  readonly defaults: {
    readonly agentPresetId: string
    readonly model: AutomationDraft['model']
    readonly modelAvailability: AutomationChoiceAvailability
    readonly permissionPresetId: string
  }
}
/** Localizable failure codes; public messages contain no provider diagnostics. */
export interface AutomationClientFailure {
  readonly code: AutomationErrorCode | 'transport'
  readonly message: string
}
/** One selected, paginated journal query owned by the Client object layer. */
export interface AutomationHistorySnapshot {
  readonly automationId: AutomationId
  readonly runs: readonly AutomationRun[]
  readonly nextCursor: AutomationRunId | null
  readonly loading: boolean
  readonly error: AutomationClientFailure | null
}
/** Identity-stable until a committed value or request lifecycle changes. */
export interface AutomationClientSnapshot {
  /** Local Host authority; mutation methods enforce the same value. */
  readonly writable: boolean
  readonly availability: 'loading' | 'ready' | 'unavailable'
  readonly loading: boolean
  readonly error: AutomationClientFailure | null
  readonly runtime: AutomationSnapshot | null
  readonly catalog: AutomationCatalog | null
  readonly catalogLoading: boolean
  readonly history: AutomationHistorySnapshot | null
}
/** Framework hook input; this interface contains no React subscription code. */
export interface AutomationSource {
  /** @returns the same object until the published state changes. */
  getSnapshot(): AutomationClientSnapshot
  /** @param listener - invalidation callback. @returns an idempotent unsubscribe function. */
  subscribe(listener: () => void): () => void
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Runtime business failure with a stable reason and bounded public message. */
    'automation/operation-failed': { readonly code: AutomationErrorCode }
  }
}
