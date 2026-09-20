/** Deployment-selected runtime artifacts and verified remote observations. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { TargetRevisionRequest, TargetValue } from '@deepseek-ai/dsh-execution-host-targets/types'

/** SHA-256 of the complete runtime manifest, also its immutable remote directory name. */
export type RuntimeGeneration = Branded<'RuntimeGeneration'>
/** Explicit credentials and pinned server identity; no ambient SSH configuration is consulted. */
export interface RuntimeEndpoint {
  readonly host: string
  readonly port: number
  readonly username: string
  readonly privateKeyFile: string
  readonly hostKeySHA256: string
}
/** Host-selected remote Node and account-owned installation directory outside the workspace. */
export interface RuntimeLocation {
  readonly endpoint: RuntimeEndpoint
  readonly node: string
  readonly installRoot: string
  readonly workspace: string
}
/** Explicit cold installation or upgrade of exactly one saved target revision. */
export interface RuntimeInstallRequest extends RuntimeLocation { readonly target: TargetRevisionRequest }
/** One regular artifact file, verified before transfer and again remotely. */
export interface RuntimeFile { readonly path: string; readonly size: number; readonly sha256: string; readonly executable: boolean }
/** Complete materialized release tree; no registry access or dependency installation is allowed remotely. */
export interface RuntimeManifest {
  readonly schemaVersion: 1
  readonly version: string
  readonly sourceCommit: string
  readonly protocol: 1
  readonly platform: 'linux' | 'darwin'
  readonly arch: 'x64' | 'arm64'
  readonly helper: string
  readonly bootstrap: string
  readonly files: readonly RuntimeFile[]
}
/** Observation from the explicit Node process; installed means hash and behavior probes passed. */
export interface RuntimeInspection {
  readonly state: 'missing' | 'installed'
  readonly platform: string
  readonly arch: string
  readonly node: string
  readonly nodeVersion: string
  readonly installRoot: string
  readonly generation: RuntimeGeneration
  readonly directory?: string | undefined
  readonly version?: string | undefined
  readonly sourceCommit?: string | undefined
  readonly protocol?: number | undefined
  readonly helper?: string | undefined
  readonly helperHash?: string | undefined
  readonly bootstrapPath?: string | undefined
  readonly bootstrapHash?: string | undefined
}
/** Durable activation and the exact generation that passed remote execution probes. */
export interface RuntimeInstallation { readonly target: Omit<TargetValue['target'], 'execution'>; readonly runtime: RuntimeInspection }
/** Stable public runtime management failure categories. */
export type RuntimeErrorCode = 'release-unavailable' | 'invalid-config' | 'connection-failed' | 'verification-failed' | 'target-changed' | 'cancelled'
/** Host-owned installation identity; closing a view never cancels this task. */
export type RuntimeTaskId = Branded<'RuntimeTaskId'>
/** Explicit install/upgrade request captured by one Host task. */
export interface RuntimeStartRequest extends RuntimeInstallRequest { readonly operation: 'install' | 'update' }
/** Exact receipt required for observation or cancellation. */
export interface RuntimeTaskRequest { readonly id: RuntimeTaskId }
/** Immutable view of one Host-owned installation. */
export interface RuntimeTask {
  readonly id: RuntimeTaskId
  readonly target: TargetRevisionRequest
  readonly operation: 'install' | 'update'
  readonly state: 'running' | 'succeeded' | 'failed' | 'cancelled'
  readonly startedAt: string
  readonly completedAt?: string
  readonly result?: RuntimeInstallation
  readonly error?: string
}
/** Serializable task observation. */
export interface RuntimeTaskValue { readonly task: RuntimeTask }
/** Redacted task inventory retained by this Host process. */
export interface RuntimeTasksValue { readonly tasks: readonly RuntimeTask[] }
/** Configurable time and transfer bounds shared by the SSH connection and remote supervisor. */
export interface RuntimeLimits {
  /** Positive total operation deadline in milliseconds, at most the Node timer maximum. */
  readonly operationTimeoutMs: number
  /** Positive grace in milliseconds before closing a cancelled SSH connection. */
  readonly shutdownTimeoutMs: number
  /** Positive maximum byte length of the pinned release manifest. */
  readonly maxManifestBytes: number
  /** Positive maximum bytes in any one uploaded runtime file. */
  readonly maxFileBytes: number
  /** Positive maximum sum of declared runtime file bytes. */
  readonly maxTotalBytes: number
  /** Positive maximum count of inventoried regular runtime files. */
  readonly maxFiles: number
  /** Positive maximum accumulated bytes from the remote installer control stream. */
  readonly maxResponseBytes: number
}
