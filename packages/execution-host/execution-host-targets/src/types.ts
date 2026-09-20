/** Serializable saved targets and observations from one authenticated worker incarnation. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ExecutionHostInfo } from '@deepseek-ai/dsh-execution-host/types'
import type { DirectoryInspection, WorkerInfo } from '@deepseek-ai/dsh-execution-host-worker/types'

export type { DirectoryInspection, WorkerInfo, ExecutionHostInfo }

/** Durable connection record identity; distinct from a worker process hostId. */
export type ExecutionTargetId = Branded<'ExecutionTargetId'>

/** Saved deployment configuration for the official SSH provider; key contents remain on the Host. */
export interface SshExecutionConfiguration {
  readonly endpoint: {
    readonly host: string
    readonly port: number
    readonly username: string
    readonly privateKeyFile: string
    readonly hostKeySHA256: string
  }
  readonly node: string
  readonly helper: string
  readonly helperHash: string
  readonly workspace: string
  /** Both bootstrap fields are required when capturing a full execution snapshot. */
  readonly bootstrapPath?: string | undefined
  readonly bootstrapHash?: string | undefined
}

/** Durable configuration and deployment identity, independent of a running worker's hostId. */
export interface SshExecutionSnapshot {
  readonly kind: 'ssh'
  readonly targetId: ExecutionTargetId
  readonly revision: number
  readonly endpoint: {
    readonly host: string
    readonly port: number
    readonly username: string
    readonly hostKeySHA256: string
  }
  readonly node: string
  readonly helper: string
  readonly helperHash: string
  readonly workspace: string
  readonly bootstrapPath: string
  readonly bootstrapHash: string
}

/** Captured execution selection; SSH resolves only its exact current or explicitly retained activation revision. */
export type ExecutionBinding = { readonly kind: 'local' } | SshExecutionSnapshot

/** Synchronous authorization held while one Agent admission persists and publishes a captured deployment. */
export interface ExecutionAuthorization {
  /**
   * Reject after release or when the registry can no longer authorize the captured deployment.
   * @returns nothing when authorization remains current.
   */
  assertCurrent(): void
  /**
   * Release mutation exclusion; repeated calls have no effect.
   * @returns nothing.
   */
  release(): void
}

/** Editable inspection alias and optional explicit execution deployment. */
export interface CreateTargetRequest {
  readonly label: string
  readonly sshAlias: string
  readonly execution?: SshExecutionConfiguration | undefined
}

/** Optimistic mutation of one saved record. */
export interface UpdateTargetRequest extends CreateTargetRequest {
  readonly id: ExecutionTargetId
  readonly revision: number
}

/** Exact saved revision for removal or connection admission. */
export interface TargetRevisionRequest {
  readonly id: ExecutionTargetId
  readonly revision: number
}

/** Exact target selector. */
export interface TargetRequest { readonly id: ExecutionTargetId }

/** Root-relative directory request bound to a live connection generation. */
export interface InspectDirectoryRequest {
  readonly id: ExecutionTargetId
  readonly generation: number
  readonly rootId: string
  readonly path: string
}

/** Persisted public record; contains no connection state or credential values. */
export interface SavedTarget extends CreateTargetRequest {
  readonly id: ExecutionTargetId
  readonly revision: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** Current observation of one connection lifetime. */
export type TargetState =
  | { readonly phase: 'disconnected' }
  | { readonly phase: 'connecting'; readonly generation: number }
  | { readonly phase: 'ready'; readonly generation: number; readonly info: WorkerInfo; readonly checkedAt: string }
  | { readonly phase: 'error'; readonly generation: number; readonly code: TargetErrorCode; readonly message: string }

/** Saved metadata with a nonpersistent connection observation. */
export interface TargetView extends SavedTarget { readonly state: TargetState }

/** Complete management snapshot. */
export interface ListTargetsValue {
  readonly targets: readonly TargetView[]
  readonly current: ExecutionHostInfo
}

/** Mutation response published after persistence or connection settlement. */
export interface TargetValue { readonly target: TargetView }

/** Completed remote inspection with its current target observation. */
export interface InspectionValue extends TargetValue { readonly inspection: DirectoryInspection }

/** Stable operational failures, safe to display without SSH diagnostics. */
export type TargetErrorCode =
  | 'invalid-request' | 'not-found' | 'conflict' | 'limit-reached' | 'roots-unconfigured'
  | 'ssh-unavailable' | 'authentication-required' | 'host-key-mismatch' | 'unreachable'
  | 'incompatible' | 'cancelled' | 'timeout' | 'connection-lost' | 'outcome-unconfirmed'
  | 'inspection-failed' | 'closed'
