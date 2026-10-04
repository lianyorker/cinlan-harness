/** Serializable saved targets and observations from one authenticated worker incarnation. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ExecutionHostInfo } from '@deepseek-ai/dsh-execution-host/types'
import type { DirectoryInspection, WorkerInfo } from '@deepseek-ai/dsh-execution-host-worker/types'

export type { DirectoryInspection, WorkerInfo, ExecutionHostInfo }

/** Durable connection record identity; distinct from a worker process hostId. */
export type ExecutionTargetId = Branded<'ExecutionTargetId'>

/**
 * Optional OpenSSH options carried by a saved endpoint. Every field is
 * connection-describing and non-secret, so all of them survive into a captured
 * execution snapshot; an omitted field keeps OpenSSH's own configuration.
 */
export interface SshEndpointOptions {
  /** Explicit ProxyCommand, for tunnels such as Cloudflare Access. */
  readonly proxyCommand?: string | undefined
  /** Explicit ProxyJump destination, equivalent to ssh -J. */
  readonly jumpHost?: string | undefined
  /** OpenSSH connection multiplexing; the target connection always dials -S none, so this field does not refine it. */
  readonly multiplex?: boolean | undefined
  /** ServerAliveInterval in seconds. */
  readonly keepAliveIntervalSeconds?: number | undefined
  /** Connection deadline in seconds. */
  readonly connectTimeoutSeconds?: number | undefined
}

/**
 * Editable connection refinements of one saved target.
 *
 * The saved alias stays the destination, so every field here is an optional
 * refinement appended after the plugin-owned OpenSSH defaults: an omitted
 * field keeps whatever the OpenSSH configuration already says. A target that
 * has not been deployed carries only this record; a deployed target also pins
 * a full SshExecutionConfiguration, whose endpoint is the authoritative
 * deployment identity for execution bindings.
 */
export interface SshConnection extends SshEndpointOptions {
  readonly port?: number | undefined
  readonly username?: string | undefined
  /** Host-owned path reference; absent means the OpenSSH agent and configuration decide. */
  readonly privateKeyFile?: string | undefined
}

/** Saved deployment configuration for the official SSH provider; key contents remain on the Host. */
export interface SshExecutionConfiguration {
  readonly endpoint: {
    readonly host: string
    readonly port: number
    readonly username: string
    readonly privateKeyFile: string
    readonly hostKeySHA256: string
  } & SshEndpointOptions
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
  } & SshEndpointOptions
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

/** Editable inspection alias, connection description and optional explicit execution deployment. */
export interface CreateTargetRequest {
  readonly label: string
  readonly sshAlias: string
  readonly connection?: SshConnection | undefined
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

/**
 * Result of one non-publishing connectivity probe.
 *
 * The probe dials the record's own endpoint through a throwaway connection and
 * never writes the live map, the state map or the generation counter, so it
 * cannot disturb an active inspection or a retained binding.
 */
export interface TargetTestValue extends TargetValue {
  /** Roots the probed worker advertised during the probe. */
  readonly rootCount: number
}

/** One concrete Host block read from the managing Host's OpenSSH configuration. */
export interface SshConfigHost {
  /** Concrete Host pattern, used as the saved target's alias. */
  readonly alias: string
  readonly host?: string | undefined
  readonly username?: string | undefined
  readonly port?: number | undefined
  readonly identityFile?: string | undefined
  readonly proxyCommand?: string | undefined
  readonly jumpHost?: string | undefined
}

/**
 * Import candidates and the exact file they were read from.
 *
 * The read is one-way: the OpenSSH configuration is never rewritten, and every
 * field is a non-secret destination detail.
 */
export interface ImportableHostsValue {
  /** Absolute path of the OpenSSH configuration that was read. */
  readonly source: string
  /** Whether that path exists; a missing file is an empty import, not a failure. */
  readonly exists: boolean
  readonly entries: readonly SshConfigHost[]
}

/** Stable operational failures, safe to display without SSH diagnostics. */
export type TargetErrorCode =
  | 'invalid-request' | 'not-found' | 'conflict' | 'limit-reached' | 'roots-unconfigured'
  | 'ssh-unavailable' | 'authentication-required' | 'host-key-mismatch' | 'unreachable'
  | 'incompatible' | 'cancelled' | 'timeout' | 'connection-lost' | 'outcome-unconfirmed'
  | 'inspection-failed' | 'configuration-unreadable' | 'closed'
