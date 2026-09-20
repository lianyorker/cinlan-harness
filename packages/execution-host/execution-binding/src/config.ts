/** Deployment bounds for remote execution provider composition. */
import schema from '@deepseek-ai/schemastery'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'

/** Defaults apply only to newly acquired remote worlds. */
export interface Config {
  /** Default sandbox policy mode for newly acquired remote worlds. */
  readonly sandboxMode: SandboxMode
  /** SSH connection and request timeout in milliseconds. */
  readonly connectionTimeoutMs: number
  /** Default one-shot shell timeout in milliseconds. */
  readonly shellTimeoutMs: number
  /** Maximum allowed one-shot shell timeout in milliseconds. */
  readonly shellMaxTimeoutMs: number
  /** Per-stream shell output limit and Git command output bound, in bytes. */
  readonly maxOutputBytes: number
  /** Maximum spill-file bytes retained per shell stream. */
  readonly maxSpillBytes: number
  /** Shell and Git process termination grace period in milliseconds. */
  readonly graceMs: number
  /** Remote Git executable name or absolute path. */
  readonly gitExecutable: string
  /** Maximum Git history entries returned by one operation. */
  readonly gitMaxLogEntries: number
  /** Remote interactive shell executable path. */
  readonly shellPath: string
}

/** Remote controls remain deployment-owned, outside model tool arguments. */
export const Config: schema<Config> = schema.object({
  sandboxMode: schema.union(['read-only', 'workspace-write', 'danger-full-access']).default('read-only'),
  connectionTimeoutMs: schema.number().min(1).max(2147483647).default(30000),
  shellTimeoutMs: schema.number().min(1).max(2147483647).default(120000),
  shellMaxTimeoutMs: schema.number().min(1).max(2147483647).default(600000),
  maxOutputBytes: schema.number().min(1).default(1048576),
  maxSpillBytes: schema.number().min(1).default(67108864),
  graceMs: schema.number().min(1).max(2147483647).default(3000),
  gitExecutable: schema.string().default('git'), gitMaxLogEntries: schema.number().min(1).default(1000),
  shellPath: schema.string().default('/bin/bash'),
})
