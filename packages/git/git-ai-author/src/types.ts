/** Shared request, result, and failure data for Git AI draft generation. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Which draft the caller asks the model to write. */
export type GitAiActionId = 'diff-review' | 'pr-description'

/** Which repository change set the draft describes. */
export type GitAiSelectionId = 'staged' | 'worktree' | 'comparison'

/** One generation request; the Host re-reads every fact from the Session. */
export interface GitAiGenerateRequest {
  /** Attached Session whose authoritative working directory selects the repository. */
  readonly sessionId: SessionId
  /** Draft kind to produce. */
  readonly action: GitAiActionId
  /** Change set to describe; `pr-description` accepts only `comparison`. */
  readonly selection: GitAiSelectionId
}

/** Repository facts captured when the input diff was read. */
export interface GitAiRepositorySnapshot {
  /** Canonical repository root at capture time. */
  readonly repositoryRoot: string
  /** Branch short name, or `HEAD` when detached. */
  readonly branch: string
  /** HEAD commit hash at capture time, or null when unborn. */
  readonly head: string | null
}

/** Comparison facts when the draft describes committed changes. */
export interface GitAiComparisonSource {
  /** The base ref the comparison selected. */
  readonly baseRef: string
  /** Pinned base commit hash. */
  readonly baseHead: string
  /** Whether the default-branch fallback was used instead of upstream. */
  readonly usedFallback: boolean
}

/** One completed draft generation. */
export interface GitAiGenerateResult {
  /** The action the draft answers, echoed from the request. */
  readonly action: GitAiActionId
  /** The change set the draft describes, echoed from the request. */
  readonly selection: GitAiSelectionId
  /** The editable draft text the model produced. */
  readonly text: string
  /** The child Session that ran the model; its log keeps inputs and outputs. */
  readonly childSessionId: SessionId
  /** Repository facts captured with the input diff. */
  readonly repository: GitAiRepositorySnapshot
  /** Comparison facts, present only for the `comparison` selection. */
  readonly comparison?: GitAiComparisonSource
  /** Sensitive paths omitted from the model input. */
  readonly omittedFiles: readonly string[]
  /** Whether the model input was truncated to fit the byte budget. */
  readonly truncated: boolean
}

/** Stable refusals and execution failures for Git AI generation. */
export type GitAiErrorCode =
  | 'unavailable'
  | 'not-repository'
  | 'invalid-request'
  | 'stale'
  | 'ai-disabled'
  | 'recipe-disabled'
  | 'empty-diff'
  | 'comparison-unavailable'
  | 'all-filtered'
  | 'no-model'
  | 'model-failed'
  | 'cancelled'
  | 'timeout'
  | 'busy'
