/** Validated deployment bounds for SSH target connections. */
import z from '@deepseek-ai/schemastery'

/** Host-owned SSH execution and resource limits. */
export interface Config {
  readonly sshExecutable: string
  readonly sshConfigFile?: string
  readonly connectTimeoutMs: number
  readonly operationTimeoutMs: number
  readonly shutdownTimeoutMs: number
  readonly maxFrameBytes: number
  readonly maxDiagnosticBytes: number
  readonly maxTargets: number
  readonly maxConcurrentInspections: number
}

/** Deployment schema; the browser cannot supply SSH flags or executable overrides. */
export const Config: z<Config> = z.object({
  sshExecutable: z.string().default('ssh'),
  sshConfigFile: z.string(),
  connectTimeoutMs: z.natural().min(1).max(2147483647).default(15000),
  operationTimeoutMs: z.natural().min(1).max(2147483647).default(30000),
  shutdownTimeoutMs: z.natural().min(1).max(2147483647).default(5000),
  maxFrameBytes: z.natural().min(1024).default(262144),
  maxDiagnosticBytes: z.natural().min(1).default(8192),
  maxTargets: z.natural().min(1).default(100),
  maxConcurrentInspections: z.natural().min(1).default(16),
})
