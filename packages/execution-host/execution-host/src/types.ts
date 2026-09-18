/** Pure process-provenance DTOs shared by Host and Client programs. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identity of one execution-host process incarnation. */
export type ExecutionHostId = Branded<'ExecutionHostId'>

/** Metadata identifying the process that produced an observation. */
export interface ExecutionHostInfo {
  readonly hostId: ExecutionHostId
  readonly hostname: string
  readonly pid: number
  readonly platform: string
  readonly createdAt: string
}
