/** PR Check status and detail types. */

/** Check run outcome classification. */
export type PRCheckConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'timed_out'
  | 'action_required'
  | 'skipped'
  | 'pending'

/** Check run execution phase. */
export type PRCheckStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'waiting'
  | 'pending'

/** Individual CI check run details. */
export interface PRCheckDetail {
  /** Check run unique identity. */
  readonly id: string
  /** Human-readable name of the check run or workflow job. */
  readonly name: string
  /** Execution status. */
  readonly status: PRCheckStatus
  /** Final outcome if completed. */
  readonly conclusion?: PRCheckConclusion
  /** ISO timestamp when the check started. */
  readonly startedAt?: string
  /** ISO timestamp when the check finished. */
  readonly completedAt?: string
  /** URL to the workflow run or job logs. */
  readonly url?: string
  /** Captured log tail if failing. */
  readonly logTail?: string
  /** GitHub check_run identity. */
  readonly checkRunId?: number
  /** GitHub workflow_run identity. */
  readonly workflowRunId?: number
}

/** Summary of the active Pull Request or Merge Request. */
export interface PRSummary {
  /** Pull request number (e.g. 42). */
  readonly number: number
  /** Pull request title. */
  readonly title: string
  /** Remote web URL. */
  readonly url: string
  /** PR author username. */
  readonly author: string
  /** Source head branch name. */
  readonly branch: string
  /** Target base branch name. */
  readonly baseBranch: string
  /** Pull request state. */
  readonly state: 'open' | 'closed' | 'merged'
  /** Whether the pull request is clean and ready to merge. */
  readonly mergeable?: boolean
  /** List of CI checks running against this PR. */
  readonly checks: readonly PRCheckDetail[]
}
