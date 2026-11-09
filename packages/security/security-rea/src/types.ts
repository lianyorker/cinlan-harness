/** Browser-safe wire types shared by `ctx.securityRea` and the generated Remotes. */
import type { ReaUnavailableReason } from './node-probe.ts'

/** Service availability states surfaced to callers and the settings page. */
export type SecurityReaState = 'disabled' | 'connecting' | 'ready' | 'unavailable'

/** Point-in-time service status. */
export interface SecurityReaStatus {
  readonly state: SecurityReaState
  /** Stable classification when state is `unavailable` or `disabled`. */
  readonly reason?: ReaUnavailableReason | 'connection-failed' | 'startup-timeout' | undefined
  /** Plain-language explanation for the settings page and chat replies. */
  readonly detail?: string | undefined
  readonly nodeVersion?: string | undefined
  /** `engines.node` range declared by the pinned `rea-agents`. */
  readonly requiredEngines?: string | undefined
  readonly reaVersion?: string | undefined
  /** REA tools currently registered as `mcp__rea__*`. */
  readonly toolCount?: number | undefined
}

/** One probed host tool in a `doctor()` report. */
export interface SecurityReaToolProbe {
  readonly name: string
  readonly detected: boolean
  readonly version?: string | undefined
  readonly hint?: string | undefined
}

/** `doctor()` report: runtime facts plus host tool availability. */
export interface SecurityReaDoctor {
  readonly status: SecurityReaStatus
  readonly stateDir: string
  readonly tools: readonly SecurityReaToolProbe[]
}
