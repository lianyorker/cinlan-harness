/** Managed per-session workspace isolation capability (`ctx.workspaceIsolation`). */

import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  EnsureWorkspaceIsolationRequest,
  WorkspaceIsolationComparison,
  WorkspaceIsolationErrorCode,
  WorkspaceIsolationInspection,
  WorkspaceIsolationIntegrationResult,
  WorkspaceIsolationLease,
  WorkspaceIsolationLeaseId,
  WorkspaceIsolationPatch,
  WorkspaceIsolationReservation,
  WorkspaceIsolationTeardownResult,
} from './types.ts'

export type * from './types.ts'

/**
 * Brand a provider-generated lease id.
 * @param value - Opaque validated provider identity.
 * @returns the same string with the lease-id brand.
 */
export function WorkspaceIsolationLeaseId(value: string): WorkspaceIsolationLeaseId {
  return value as WorkspaceIsolationLeaseId
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    workspaceIsolation: WorkspaceIsolation
  }
}

/** Provider-neutral workspace-isolation rejection. */
export class WorkspaceIsolationError extends Error {
  /**
   * @param code - Stable failure classification.
   * @param message - Human-readable failure and correction.
   * @param options - Optional causal error.
   */
  constructor(readonly code: WorkspaceIsolationErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WorkspaceIsolationError'
  }
}

/**
 * Provider-neutral lease service. Providers alone choose checkout paths and
 * accept cleanup by lease id; Consumers cannot submit a deletion path.
 */
export abstract class WorkspaceIsolation extends Service {
  constructor(ctx: Context) {
    super(ctx, 'workspaceIsolation')
  }

  /**
   * Create or reactivate the Session's lease.
   * @param request - Session identity, registered source directory, and cancellation.
   * @returns the active lease whose checkoutPath is ready for Session use.
   */
  abstract ensure(request: EnsureWorkspaceIsolationRequest): Promise<WorkspaceIsolationLease>

  /**
   * Create or reactivate a lease and protect it atomically for an asynchronous consumer.
   * @param request - Lease owner, source directory, and cancellation during acquisition.
   * @returns the active lease and an idempotent release callback; release only after work stops.
   */
  abstract acquire(request: EnsureWorkspaceIsolationRequest): Promise<WorkspaceIsolationReservation>

  /**
   * Reactivate an existing lease by provider-issued identity.
   * @param leaseId - Provider-issued lease identity.
   * @param signal - Optional cancellation for provider work.
   * @returns the active lease whose checkoutPath is ready for Session use.
   */
  abstract activate(
    leaseId: WorkspaceIsolationLeaseId,
    signal?: AbortSignal,
  ): Promise<WorkspaceIsolationLease>

  /**
   * Checkpoint one inactive checkout and reclaim its directory while retaining its branch.
   * @param leaseId - Provider-issued lease identity.
   * @returns the hibernated lease after the directory is removed.
   */
  abstract hibernate(leaseId: WorkspaceIsolationLeaseId): Promise<WorkspaceIsolationLease>

  /**
   * Inspect checkout ownership and working-tree state without changing the lease.
   * @param leaseId - Provider-issued lease identity.
   * @param signal - Optional cancellation for provider work.
   * @returns current checkout and managed-branch state.
   */
  abstract inspect(
    leaseId: WorkspaceIsolationLeaseId,
    signal?: AbortSignal,
  ): Promise<WorkspaceIsolationInspection>

  /**
   * Compare one managed branch and active checkout with its base branch.
   * @param leaseId - Provider-issued lease identity.
   * @param signal - Optional cancellation for provider work.
   * @returns bounded commits, changed paths, and patch text.
   */
  abstract compare(
    leaseId: WorkspaceIsolationLeaseId,
    signal?: AbortSignal,
  ): Promise<WorkspaceIsolationComparison>

  /**
   * Merge one managed branch into its clean source checkout and hibernate the lease.
   * @param leaseId - Provider-issued lease identity.
   * @param signal - Optional cancellation for provider work.
   * @returns resulting base-branch commit and retained lease.
   */
  abstract merge(
    leaseId: WorkspaceIsolationLeaseId,
    signal?: AbortSignal,
  ): Promise<WorkspaceIsolationIntegrationResult>

  /**
   * Cherry-pick the managed branch's linear commits into its clean source checkout.
   * @param leaseId - Provider-issued lease identity.
   * @param signal - Optional cancellation for provider work.
   * @returns resulting base-branch commit and retained lease.
   */
  abstract cherryPick(
    leaseId: WorkspaceIsolationLeaseId,
    signal?: AbortSignal,
  ): Promise<WorkspaceIsolationIntegrationResult>

  /**
   * Export one complete bounded patch without accepting a browser-supplied path.
   * @param leaseId - Provider-issued lease identity.
   * @param signal - Optional cancellation for provider work.
   * @returns patch content and omission metadata.
   */
  abstract exportPatch(
    leaseId: WorkspaceIsolationLeaseId,
    signal?: AbortSignal,
  ): Promise<WorkspaceIsolationPatch>

  /**
   * Reclaim one managed checkout and delete its branch only after safe integration.
   * @param leaseId - Provider-issued lease identity.
   * @returns removal acknowledgement or a retained branch requiring review.
   */
  abstract teardown(leaseId: WorkspaceIsolationLeaseId): Promise<WorkspaceIsolationTeardownResult>

  /**
   * Clean up provider-detected orphaned worktrees within the repositories in scope.
   * Providers may limit discovery to repositories represented by durable lease records.
   * @returns the count of orphaned worktrees removed.
   */
  abstract pruneOrphans(): Promise<number>

  /**
   * Find the lease owned by a Session without filesystem work.
   * @param sessionId - Session identity.
   * @returns the current lease snapshot, or undefined when the Session is shared.
   */
  abstract find(sessionId: SessionId): WorkspaceIsolationLease | undefined

  /**
   * Verify that an exact Session cwd belongs to its managed lease and return
   * the registered source directory used for Workspace membership.
   * @param sessionId - Session identity from the immutable header.
   * @param cwd - Exact cwd from the same header.
   * @returns the source directory, or undefined for an unrelated path.
   */
  abstract sourceFor(sessionId: SessionId, cwd: string): string | undefined

  /**
   * List detached snapshots of every provider-owned lease.
   * @returns all current lease snapshots.
   */
  abstract list(): readonly WorkspaceIsolationLease[]
}

export default WorkspaceIsolation
