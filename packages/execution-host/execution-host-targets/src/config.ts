/** Validated deployment bounds for SSH target connections. */
import z from '@deepseek-ai/schemastery'

/** Host-owned SSH execution and resource limits. */
export interface Config {
  /** OpenSSH executable resolved by the managed subprocess provider. */
  readonly sshExecutable: string
  /** Optional OpenSSH configuration file passed with -F. */
  readonly sshConfigFile?: string
  /** Deadline in milliseconds for SSH connection and worker initialization. */
  readonly connectTimeoutMs: number
  /** Deadline in milliseconds before cancelling a remote directory inspection. */
  readonly operationTimeoutMs: number
  /** Milliseconds allowed for cancellation acknowledgment, shutdown, and process termination. */
  readonly shutdownTimeoutMs: number
  /** UTF-8 byte cap for a complete worker JSON-RPC frame. */
  readonly maxFrameBytes: number
  /** Maximum retained bytes from the SSH process's diagnostic stream. */
  readonly maxDiagnosticBytes: number
  /** Maximum number of saved SSH targets. */
  readonly maxTargets: number
  /** Maximum simultaneous inspections on one SSH target connection. */
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
