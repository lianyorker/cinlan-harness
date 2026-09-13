/** Host Remote controller for provider-owned Workspace Isolation leases. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { WorkspaceIsolationError } from '@deepseek-ai/dsh-workspace-isolation'
import type {
  WorkspaceIsolation,
  WorkspaceIsolationComparison,
  WorkspaceIsolationFileChange,
  WorkspaceIsolationInspection,
  WorkspaceIsolationIntegrationResult,
  WorkspaceIsolationLease,
  WorkspaceIsolationPatch,
  WorkspaceIsolationTeardownResult,
} from '@deepseek-ai/dsh-workspace-isolation'
import type {
  WorkspaceIsolationComparisonValue,
  WorkspaceIsolationComparisonView,
  WorkspaceIsolationFileChangeView,
  WorkspaceIsolationInspectionValue,
  WorkspaceIsolationInspectionView,
  WorkspaceIsolationIntegrationValue,
  WorkspaceIsolationLeaseId,
  WorkspaceIsolationLeaseRequest,
  WorkspaceIsolationLeaseValue,
  WorkspaceIsolationLeaseView,
  WorkspaceIsolationListValue,
  WorkspaceIsolationOperation,
  WorkspaceIsolationPatchValue,
  WorkspaceIsolationPruneValue,
  WorkspaceIsolationTeardownValue,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `workspaceIsolation` Remote namespace. */
    workspaceIsolationController: WorkspaceIsolationController
  }
}

/** Host API exposing lease ids and detached state, never deletion paths. */
export class WorkspaceIsolationController extends TypertRemoteService {
  static inject = ['typert']

  /** @param ctx - Host context carrying the optional isolation provider. */
  constructor(ctx: Context) {
    super(ctx, 'workspaceIsolationController', { namespace: 'workspaceIsolation' })
  }

  /**
   * List every provider-owned lease without activating a checkout.
   * @param signal - Caller cancellation checked before reading provider state.
   * @returns detached active and hibernated lease projections.
   */
  @Remote('list')
  list(signal: AbortSignal): WorkspaceIsolationListValue {
    this.admit('list', signal)
    try {
      return { items: this.provider().list().map(projectLease) }
    } catch (error) {
      throw mapFailure('list', undefined, error)
    }
  }

  /**
   * Materialize one hibernated lease.
   * @param request - Exact provider-issued lease identity.
   * @param signal - Caller cancellation forwarded to provider work.
   * @returns detached active lease state.
   */
  @Remote('activate')
  async activate(
    request: WorkspaceIsolationLeaseRequest,
    signal: AbortSignal,
  ): Promise<WorkspaceIsolationLeaseValue> {
    this.admit('activate', signal)
    const service = this.provider()
    try {
      const lease = await service.activate(request.leaseId, signal)
      this.admit('activate', signal)
      return { lease: projectLease(lease) }
    } catch (error) {
      throw mapFailure('activate', request.leaseId, error, signal)
    }
  }

  /**
   * Checkpoint and reclaim one inactive checkout while retaining its branch.
   * @param request - Exact provider-issued lease identity.
   * @param signal - Caller cancellation checked before provider admission.
   * @returns detached hibernated lease state.
   */
  @Remote('hibernate')
  async hibernate(
    request: WorkspaceIsolationLeaseRequest,
    signal: AbortSignal,
  ): Promise<WorkspaceIsolationLeaseValue> {
    this.admit('hibernate', signal)
    try {
      return { lease: projectLease(await this.provider().hibernate(request.leaseId)) }
    } catch (error) {
      throw mapFailure('hibernate', request.leaseId, error)
    }
  }

  /**
   * Inspect checkout ownership and working-tree state without mutation.
   * @param request - Exact provider-issued lease identity.
   * @param signal - Caller cancellation forwarded to provider work.
   * @returns detached lightweight inspection.
   */
  @Remote('inspect')
  async inspect(
    request: WorkspaceIsolationLeaseRequest,
    signal: AbortSignal,
  ): Promise<WorkspaceIsolationInspectionValue> {
    this.admit('inspect', signal)
    try {
      const inspection = await this.provider().inspect(request.leaseId, signal)
      this.admit('inspect', signal)
      return { inspection: projectInspection(inspection) }
    } catch (error) {
      throw mapFailure('inspect', request.leaseId, error, signal)
    }
  }

  /**
   * Compare one lease with its current base branch.
   * @param request - Exact provider-issued lease identity.
   * @param signal - Caller cancellation forwarded to provider work.
   * @returns detached bounded comparison.
   */
  @Remote('compare')
  async compare(
    request: WorkspaceIsolationLeaseRequest,
    signal: AbortSignal,
  ): Promise<WorkspaceIsolationComparisonValue> {
    this.admit('compare', signal)
    try {
      const comparison = await this.provider().compare(request.leaseId, signal)
      this.admit('compare', signal)
      return { comparison: projectComparison(comparison) }
    } catch (error) {
      throw mapFailure('compare', request.leaseId, error, signal)
    }
  }

  /**
   * Merge a managed branch into its clean recorded base checkout.
   * @param request - Exact provider-issued lease identity.
   * @param signal - Caller cancellation forwarded to provider work.
   * @returns detached integration receipt.
   */
  @Remote('merge')
  async merge(
    request: WorkspaceIsolationLeaseRequest,
    signal: AbortSignal,
  ): Promise<WorkspaceIsolationIntegrationValue> {
    return this.integrate('merge', request, signal)
  }

  /**
   * Cherry-pick a managed branch's linear commits into its clean recorded base checkout.
   * @param request - Exact provider-issued lease identity.
   * @param signal - Caller cancellation forwarded to provider work.
   * @returns detached integration receipt.
   */
  @Remote('cherryPick')
  async cherryPick(
    request: WorkspaceIsolationLeaseRequest,
    signal: AbortSignal,
  ): Promise<WorkspaceIsolationIntegrationValue> {
    return this.integrate('cherryPick', request, signal)
  }

  /**
   * Export a complete bounded patch without accepting a browser-supplied path.
   * @param request - Exact provider-issued lease identity.
   * @param signal - Caller cancellation forwarded to provider work.
   * @returns patch content and omission metadata.
   */
  @Remote('exportPatch')
  async exportPatch(
    request: WorkspaceIsolationLeaseRequest,
    signal: AbortSignal,
  ): Promise<WorkspaceIsolationPatchValue> {
    this.admit('exportPatch', signal)
    try {
      const patch = await this.provider().exportPatch(request.leaseId, signal)
      this.admit('exportPatch', signal)
      return projectPatch(patch)
    } catch (error) {
      throw mapFailure('exportPatch', request.leaseId, error, signal)
    }
  }

  /**
   * Reclaim one checkout and delete its branch only after safe integration.
   * @param request - Exact provider-issued lease identity.
   * @param signal - Caller cancellation checked before provider admission.
   * @returns removal acknowledgement or a retained branch requiring review.
   */
  @Remote('teardown')
  async teardown(
    request: WorkspaceIsolationLeaseRequest,
    signal: AbortSignal,
  ): Promise<WorkspaceIsolationTeardownValue> {
    this.admit('teardown', signal)
    try {
      return projectTeardown(await this.provider().teardown(request.leaseId))
    } catch (error) {
      throw mapFailure('teardown', request.leaseId, error)
    }
  }

  /**
   * Remove provider-detected orphaned worktrees in its bounded scan scope.
   * @param signal - Caller cancellation checked before provider admission.
   * @returns number of orphaned worktrees removed.
   */
  @Remote('prune')
  async prune(signal: AbortSignal): Promise<WorkspaceIsolationPruneValue> {
    this.admit('prune', signal)
    try {
      return { pruned: await this.provider().pruneOrphans() }
    } catch (error) {
      throw mapFailure('prune', undefined, error)
    }
  }

  private async integrate(
    operation: 'merge' | 'cherryPick',
    request: WorkspaceIsolationLeaseRequest,
    signal: AbortSignal,
  ): Promise<WorkspaceIsolationIntegrationValue> {
    this.admit(operation, signal)
    try {
      const service = this.provider()
      const result = operation === 'merge'
        ? await service.merge(request.leaseId, signal)
        : await service.cherryPick(request.leaseId, signal)
      this.admit(operation, signal)
      return projectIntegration(result)
    } catch (error) {
      throw mapFailure(operation, request.leaseId, error, signal)
    }
  }

  private provider(): WorkspaceIsolation {
    const provider = this.ctx.get('workspaceIsolation')
    if (provider === undefined) {
      throw new RemoteError(
        'workspace-isolation/unavailable',
        'Workspace isolation is unavailable in this Host composition',
        {},
      )
    }
    return provider
  }

  private admit(operation: WorkspaceIsolationOperation, signal: AbortSignal): void {
    if (signal.aborted) throw cancelled(operation, signal.reason)
  }
}

/** Project one trusted provider object field by field into detached JSON data. */
function projectLease(lease: WorkspaceIsolationLease): WorkspaceIsolationLeaseView {
  return {
    leaseId: lease.id,
    sessionId: lease.sessionId,
    sourcePath: lease.sourcePath,
    checkoutPath: lease.checkoutPath,
    branch: lease.branch,
    phase: lease.phase,
    reviewState: lease.reviewState,
    baseBranch: lease.baseBranch,
    baseHead: lease.baseHead,
    head: lease.head,
    createdAt: lease.createdAt,
    updatedAt: lease.updatedAt,
  }
}

function projectFileChange(change: WorkspaceIsolationFileChange): WorkspaceIsolationFileChangeView {
  return {
    kind: change.kind,
    path: change.path,
    ...(change.previousPath === undefined ? {} : { previousPath: change.previousPath }),
  }
}

function projectInspection(inspection: WorkspaceIsolationInspection): WorkspaceIsolationInspectionView {
  return {
    lease: projectLease(inspection.lease),
    checkoutState: inspection.checkoutState,
    branchHead: inspection.branchHead,
    workingTreeChanges: inspection.workingTreeChanges.map(projectFileChange),
    hasUntrackedFiles: inspection.hasUntrackedFiles,
  }
}

function projectComparison(comparison: WorkspaceIsolationComparison): WorkspaceIsolationComparisonView {
  return {
    lease: projectLease(comparison.lease),
    targetHead: comparison.targetHead,
    branchHead: comparison.branchHead,
    ahead: comparison.ahead,
    behind: comparison.behind,
    commits: comparison.commits.map(commit => ({ id: commit.id, summary: commit.summary })),
    changedFiles: comparison.changedFiles.map(projectFileChange),
    patch: comparison.patch,
    patchTruncated: comparison.patchTruncated,
    includesWorkingTree: comparison.includesWorkingTree,
    hasUntrackedFiles: comparison.hasUntrackedFiles,
  }
}

function projectIntegration(result: WorkspaceIsolationIntegrationResult): WorkspaceIsolationIntegrationValue {
  return {
    lease: projectLease(result.lease),
    targetBranch: result.targetBranch,
    targetHead: result.targetHead,
  }
}

function projectPatch(patch: WorkspaceIsolationPatch): WorkspaceIsolationPatchValue {
  return {
    leaseId: patch.leaseId,
    fileName: patch.fileName,
    content: patch.content,
    includesWorkingTree: patch.includesWorkingTree,
    hasUntrackedFiles: patch.hasUntrackedFiles,
  }
}

function projectTeardown(result: WorkspaceIsolationTeardownResult): WorkspaceIsolationTeardownValue {
  if (result.status === 'removed') return { status: 'removed', leaseId: result.leaseId }
  return { status: 'review', lease: projectLease(result.lease), reason: result.reason }
}

function mapFailure(
  operation: WorkspaceIsolationOperation,
  leaseId: WorkspaceIsolationLeaseId | undefined,
  error: unknown,
  signal?: AbortSignal,
): unknown {
  if (signal?.aborted === true) return cancelled(operation, error)
  if (!(error instanceof WorkspaceIsolationError)) return error
  if (error.code === 'UNAVAILABLE') {
    return new RemoteError('workspace-isolation/unavailable', error.message, {}, { cause: error })
  }
  if (error.code === 'LEASE_BUSY' && leaseId !== undefined && operation !== 'list' && operation !== 'prune') {
    return new RemoteError('workspace-isolation/busy', error.message, { operation, leaseId }, { cause: error })
  }
  if (error.code === 'LEASE_CONFLICT' && leaseId !== undefined && operation !== 'list' && operation !== 'prune') {
    return new RemoteError('workspace-isolation/conflict', error.message, { operation, leaseId }, { cause: error })
  }
  return new RemoteError(
    'workspace-isolation/operation-failed',
    error.message,
    { operation, ...(leaseId === undefined ? {} : { leaseId }), providerCode: error.code },
    { cause: error },
  )
}

function cancelled(operation: WorkspaceIsolationOperation, cause: unknown): RemoteError<'gateway/cancelled'> {
  return new RemoteError(
    'gateway/cancelled',
    `Workspace isolation ${operation} was cancelled`,
    {},
    { cause },
  )
}

export default WorkspaceIsolationController
