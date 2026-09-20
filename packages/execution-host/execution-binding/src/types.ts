/** Captured execution location and caller-owned provider leases. */
import type { Context } from '@deepseek-ai/cordis'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ExecutionBinding } from '@deepseek-ai/dsh-execution-host-targets/types'
export type { ExecutionBinding, SshExecutionSnapshot } from '@deepseek-ai/dsh-execution-host-targets/types'

/** One process-local execution connection lifetime. */
export type ExecutionIncarnation = Branded<'ExecutionIncarnation'>

/** Providers captured for one operation or retained process; release only after owned work settles. */
export interface ExecutionLease {
  readonly binding: ExecutionBinding
  /** Captured realm; use ctx.get(name) and reject absence rather than property-proxy lookup or Host fallback. */
  readonly ctx: Context
  readonly cwd: string
  readonly platform: NodeJS.Platform
  readonly incarnation: ExecutionIncarnation
  readonly signal: AbortSignal
  /** Reject a released or disconnected world without selecting another provider. */
  assertCurrent(): void
  /** Release this holder and join provider teardown when it is the final holder. */
  release(): Promise<void>
}
