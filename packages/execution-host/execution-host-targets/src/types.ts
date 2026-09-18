/** Serializable saved targets and observations from one authenticated worker incarnation. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ExecutionHostInfo } from '@deepseek-ai/dsh-execution-host/types'
import type { DirectoryInspection, WorkerInfo } from '@deepseek-ai/dsh-execution-host-worker/types'

export type { DirectoryInspection, WorkerInfo, ExecutionHostInfo }

/** Durable connection record identity; distinct from a worker process hostId. */
export type ExecutionTargetId = Branded<'ExecutionTargetId'>

/** Editable connection data; authentication remains owned by OpenSSH configuration. */
export interface CreateTargetRequest {
  readonly label: string
  readonly sshAlias: string
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
