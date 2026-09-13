/** Browser-safe requests and projections for Workspace Isolation management. */
import type {
  WorkspaceIsolationCheckoutState,
  WorkspaceIsolationErrorCode,
  WorkspaceIsolationFileChangeKind,
  WorkspaceIsolationLease,
  WorkspaceIsolationReviewState,
} from '@deepseek-ai/dsh-workspace-isolation/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Opaque provider-issued lease identity. */
export type WorkspaceIsolationLeaseId = WorkspaceIsolationLease['id']

/** Current provider-owned checkout lifecycle. */
export type WorkspaceIsolationPhase = WorkspaceIsolationLease['phase']

/** Durable reason a safely retained lease remains visible. */
export type WorkspaceIsolationReview = WorkspaceIsolationReviewState

/** Lifecycle and review operation names exposed by the Remote namespace. */
export type WorkspaceIsolationOperation =
  | 'list'
  | 'activate'
  | 'hibernate'
  | 'inspect'
  | 'compare'
  | 'merge'
  | 'cherryPick'
  | 'exportPatch'
  | 'teardown'
  | 'prune'

/** Operations that address one opaque lease identity. */
export type WorkspaceIsolationLeaseOperation = Exclude<WorkspaceIsolationOperation, 'list' | 'prune'>

/** Opaque identity accepted by a single-lease lifecycle command. */
export interface WorkspaceIsolationLeaseRequest {
  /** Provider-issued lease identity; no filesystem path is accepted. */
  readonly leaseId: WorkspaceIsolationLeaseId
}

/** Detached JSON projection of one provider-owned lease. */
export interface WorkspaceIsolationLeaseView {
  /** Provider-issued identity. */
  readonly leaseId: WorkspaceIsolationLeaseId
  /** Session that owns the lease. */
  readonly sessionId: SessionId
  /** Canonical registered Workspace directory. */
  readonly sourcePath: string
  /** Managed checkout used as the Session cwd while active. */
  readonly checkoutPath: string
  /** Provider-owned branch retained across hibernation. */
  readonly branch: string
  /** Current checkout lifecycle. */
  readonly phase: WorkspaceIsolationPhase
  /** Durable state explaining why safe teardown retained the branch. */
  readonly reviewState: WorkspaceIsolationReview
  /** Base branch from which the managed branch was created. */
  readonly baseBranch: string
  /** Commit from which the managed branch was created. */
  readonly baseHead: string
  /** Latest checkpoint commit known to the provider. */
  readonly head: string
  /** ISO-8601 lease creation instant. */
  readonly createdAt: string
  /** ISO-8601 latest successful lifecycle transition. */
  readonly updatedAt: string
}

/** Detached changed-path projection. */
export interface WorkspaceIsolationFileChangeView {
  /** Provider-neutral change classification. */
  readonly kind: WorkspaceIsolationFileChangeKind
  /** Current repository-relative path. */
  readonly path: string
  /** Prior path for a rename or copy. */
  readonly previousPath?: string
}

/** Detached lightweight inspection of one lease. */
export interface WorkspaceIsolationInspectionView {
  /** Lease inspected by the provider. */
  readonly lease: WorkspaceIsolationLeaseView
  /** Whether the managed checkout is absent, clean, or dirty. */
  readonly checkoutState: WorkspaceIsolationCheckoutState
  /** Current managed-branch commit. */
  readonly branchHead: string
  /** Active-checkout changes not represented solely by branch commits. */
  readonly workingTreeChanges: readonly WorkspaceIsolationFileChangeView[]
  /** Whether untracked files exist and are omitted from patch text. */
  readonly hasUntrackedFiles: boolean
}

/** Detached managed-branch commit summary. */
export interface WorkspaceIsolationCommitView {
  /** Commit object identity. */
  readonly id: string
  /** First line of the commit message. */
  readonly summary: string
}

/** Detached bounded comparison for review UI. */
export interface WorkspaceIsolationComparisonView {
  /** Lease used for the comparison. */
  readonly lease: WorkspaceIsolationLeaseView
  /** Current base-branch commit. */
  readonly targetHead: string
  /** Current managed-branch commit. */
  readonly branchHead: string
  /** Managed-branch commits absent from the base branch. */
  readonly ahead: number
  /** Base-branch commits absent from the managed branch. */
  readonly behind: number
  /** Managed-branch commits after lease creation, oldest first. */
  readonly commits: readonly WorkspaceIsolationCommitView[]
  /** Changed paths represented by the comparison plus active untracked paths. */
  readonly changedFiles: readonly WorkspaceIsolationFileChangeView[]
  /** Bounded patch text. */
  readonly patch: string
  /** Whether the provider truncated patch text at its output limit. */
  readonly patchTruncated: boolean
  /** Whether tracked active-checkout content is included. */
  readonly includesWorkingTree: boolean
  /** Whether untracked files exist and are omitted from patch text. */
  readonly hasUntrackedFiles: boolean
}

/** Complete current lease list. */
export interface WorkspaceIsolationListValue {
  /** Provider-owned leases, including hibernated records. */
  readonly items: readonly WorkspaceIsolationLeaseView[]
}

/** Updated lease returned by activate and hibernate. */
export interface WorkspaceIsolationLeaseValue {
  /** Detached lease after the lifecycle transition. */
  readonly lease: WorkspaceIsolationLeaseView
}

/** Lightweight inspection response. */
export interface WorkspaceIsolationInspectionValue {
  /** Detached current lease inspection. */
  readonly inspection: WorkspaceIsolationInspectionView
}

/** Bounded comparison response. */
export interface WorkspaceIsolationComparisonValue {
  /** Detached current lease comparison. */
  readonly comparison: WorkspaceIsolationComparisonView
}

/** Merge or cherry-pick response. */
export interface WorkspaceIsolationIntegrationValue {
  /** Hibernated retained lease after integration. */
  readonly lease: WorkspaceIsolationLeaseView
  /** Recorded base branch that received changes. */
  readonly targetBranch: string
  /** Resulting base-branch commit. */
  readonly targetHead: string
}

/** Patch export response. */
export interface WorkspaceIsolationPatchValue {
  /** Lease whose changes produced the patch. */
  readonly leaseId: WorkspaceIsolationLeaseId
  /** Safe suggested browser download filename. */
  readonly fileName: string
  /** Complete bounded patch content. */
  readonly content: string
  /** Whether tracked active-checkout content is included. */
  readonly includesWorkingTree: boolean
  /** Whether untracked files exist and are omitted. */
  readonly hasUntrackedFiles: boolean
}

/** Safe teardown response; unmerged work remains visible. */
export type WorkspaceIsolationTeardownValue =
  | {
    /** Checkout, branch, and durable lease were removed. */
    readonly status: 'removed'
    /** Removed provider-issued identity. */
    readonly leaseId: WorkspaceIsolationLeaseId
  }
  | {
    /** Checkout was reclaimed while branch and durable lease remain. */
    readonly status: 'review'
    /** Retained hibernated lease. */
    readonly lease: WorkspaceIsolationLeaseView
    /** Stable reason the provider refused branch deletion. */
    readonly reason: 'unmerged-branch'
  }

/** Orphan-pruning result. */
export interface WorkspaceIsolationPruneValue {
  /** Number of provider-detected orphaned worktrees removed. */
  readonly pruned: number
}

/** Details for a lifecycle rejection tied to one lease. */
export interface WorkspaceIsolationLeaseFailureDetails {
  /** Rejected single-lease operation. */
  readonly operation: WorkspaceIsolationLeaseOperation
  /** Provider-issued lease identity. */
  readonly leaseId: WorkspaceIsolationLeaseId
}

/** Details for a classified provider failure not represented by a narrower code. */
export interface WorkspaceIsolationOperationFailureDetails {
  /** Rejected lifecycle or review operation. */
  readonly operation: WorkspaceIsolationOperation
  /** Lease identity when the operation addressed one lease. */
  readonly leaseId?: WorkspaceIsolationLeaseId
  /** Stable provider-neutral failure classification. */
  readonly providerCode: WorkspaceIsolationErrorCode
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No Workspace Isolation provider is mounted in this Host. */
    'workspace-isolation/unavailable': {}
    /** A live owner or reservation prevents the requested lease mutation. */
    'workspace-isolation/busy': WorkspaceIsolationLeaseFailureDetails
    /** The opaque lease no longer identifies the requested provider state. */
    'workspace-isolation/conflict': WorkspaceIsolationLeaseFailureDetails
    /** Provider failure that has no narrower Remote classification. */
    'workspace-isolation/operation-failed': WorkspaceIsolationOperationFailureDetails
  }
}
