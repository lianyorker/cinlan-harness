/** Provider-neutral types for managed per-session workspace isolation. */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Opaque identity of one provider-owned isolation lease. */
export type WorkspaceIsolationLeaseId = Branded<'WorkspaceIsolationLeaseId'>

/** Persisted checkout lifecycle. Hibernation retains the branch without its directory. */
export type WorkspaceIsolationPhase = 'active' | 'hibernated'

/** Durable review marker set when safe teardown retains an unmerged branch. */
export type WorkspaceIsolationReviewState = 'none' | 'branch-retained'

/** Provider-neutral checkout availability and cleanliness. */
export type WorkspaceIsolationCheckoutState = 'absent' | 'clean' | 'dirty'

/** Provider-neutral classification of one changed path. */
export type WorkspaceIsolationFileChangeKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type-changed'
  | 'unmerged'
  | 'untracked'
  | 'other'

/** Stable provider-neutral failure codes. */
export type WorkspaceIsolationErrorCode =
  | 'UNAVAILABLE'
  | 'NOT_REPOSITORY'
  | 'SOURCE_DIRTY'
  | 'LEASE_CONFLICT'
  | 'LEASE_BUSY'
  | 'CAPACITY'
  | 'COMMAND_FAILED'

/** One managed checkout and the branch that survives directory reclamation. */
export interface WorkspaceIsolationLease {
  /** Opaque lease identity; cleanup accepts this id, never an arbitrary path. */
  readonly id: WorkspaceIsolationLeaseId
  /** Session that exclusively owns the lease. */
  readonly sessionId: SessionId
  /** Canonical registered Workspace directory. */
  readonly sourcePath: string
  /** Session cwd inside the managed worktree. */
  readonly checkoutPath: string
  /** Provider-owned branch retained after hibernation. */
  readonly branch: string
  /** Current checkout lifecycle. */
  readonly phase: WorkspaceIsolationPhase
  /** Durable state explaining why a teardown request retained this lease. */
  readonly reviewState: WorkspaceIsolationReviewState
  /** Base branch name from which the worktree was created (e.g., "main", "master"). */
  readonly baseBranch: string
  /** Commit from which the branch was created. */
  readonly baseHead: string
  /** Latest checkpoint commit known to the provider. */
  readonly head: string
  /** ISO-8601 lease creation instant. */
  readonly createdAt: string
  /** ISO-8601 latest successful lifecycle transition. */
  readonly updatedAt: string
}

/** One path changed relative to a lease's creation commit. */
export interface WorkspaceIsolationFileChange {
  /** Provider-neutral change classification. */
  readonly kind: WorkspaceIsolationFileChangeKind
  /** Current path relative to the repository root. */
  readonly path: string
  /** Prior path for a rename or copy. */
  readonly previousPath?: string
}

/** Lightweight current state for one managed lease. */
export interface WorkspaceIsolationInspection {
  /** Detached lease snapshot inspected by the provider. */
  readonly lease: WorkspaceIsolationLease
  /** Whether the managed checkout is absent, clean, or dirty. */
  readonly checkoutState: WorkspaceIsolationCheckoutState
  /** Current commit at the managed branch ref. */
  readonly branchHead: string
  /** Active-checkout changes not yet represented solely by branch commits. */
  readonly workingTreeChanges: readonly WorkspaceIsolationFileChange[]
  /** Whether untracked files exist and are omitted from patch text. */
  readonly hasUntrackedFiles: boolean
}

/** One managed-branch commit not present in the lease's creation commit. */
export interface WorkspaceIsolationCommit {
  /** Commit object identity. */
  readonly id: string
  /** First line of the commit message. */
  readonly summary: string
}

/** Bounded review data for one lease against its current base branch. */
export interface WorkspaceIsolationComparison {
  /** Detached lease snapshot used for the comparison. */
  readonly lease: WorkspaceIsolationLease
  /** Current commit at the base branch ref. */
  readonly targetHead: string
  /** Current commit at the managed branch ref. */
  readonly branchHead: string
  /** Managed-branch commits absent from the current base branch. */
  readonly ahead: number
  /** Base-branch commits absent from the managed branch. */
  readonly behind: number
  /** Managed-branch commits after the lease's creation commit, oldest first. */
  readonly commits: readonly WorkspaceIsolationCommit[]
  /** Changed paths represented by the comparison plus active untracked paths. */
  readonly changedFiles: readonly WorkspaceIsolationFileChange[]
  /** Bounded patch text against the lease's creation commit. */
  readonly patch: string
  /** Whether the patch exceeded the provider's output limit. */
  readonly patchTruncated: boolean
  /** Whether tracked active-checkout content is included in the patch. */
  readonly includesWorkingTree: boolean
  /** Whether untracked files exist and are omitted from patch text. */
  readonly hasUntrackedFiles: boolean
}

/** Successful integration of one managed branch into its source checkout. */
export interface WorkspaceIsolationIntegrationResult {
  /** Hibernated lease after its active checkout was checkpointed and reclaimed. */
  readonly lease: WorkspaceIsolationLease
  /** Base branch that received the integration. */
  readonly targetBranch: string
  /** Resulting commit at the base branch. */
  readonly targetHead: string
}

/** Bounded patch export for one managed lease. */
export interface WorkspaceIsolationPatch {
  /** Lease whose changes produced the patch. */
  readonly leaseId: WorkspaceIsolationLeaseId
  /** Safe suggested download filename. */
  readonly fileName: string
  /** Complete patch text within the provider's configured output limit. */
  readonly content: string
  /** Whether tracked active-checkout content is included. */
  readonly includesWorkingTree: boolean
  /** Whether untracked files exist and are omitted from the export. */
  readonly hasUntrackedFiles: boolean
}

/** Safe teardown result; unmerged work is retained for review. */
export type WorkspaceIsolationTeardownResult =
  | {
    /** Checkout, branch, and durable lease were removed. */
    readonly status: 'removed'
    /** Removed provider-issued identity. */
    readonly leaseId: WorkspaceIsolationLeaseId
  }
  | {
    /** The checkout was reclaimed but the branch and durable lease remain. */
    readonly status: 'review'
    /** Retained hibernated lease. */
    readonly lease: WorkspaceIsolationLease
    /** Stable reason the provider refused branch deletion. */
    readonly reason: 'unmerged-branch'
  }

/** Request to create or reactivate the one lease owned by a Session. */
export interface WorkspaceIsolationReservation {
  /** Active lease protected from hibernation, teardown, and capacity reclamation. */
  readonly lease: WorkspaceIsolationLease
  /** Idempotently release protection after the consumer's work has stopped. */
  release(): void
}

/** Request to create or reactivate the one lease owned by a Session. */
export interface EnsureWorkspaceIsolationRequest {
  /** Session that will use the checkout as its cwd. */
  readonly sessionId: SessionId
  /** Registered Workspace directory to isolate. */
  readonly sourcePath: string
  /** Optional cancellation signal for Git and filesystem work. */
  readonly signal?: AbortSignal
}
