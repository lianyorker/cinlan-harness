/** Runtime release inputs and bounded installation operations. */
import schema from '@deepseek-ai/schemastery'
import type { RuntimeLimits } from './types.ts'

/** Deployment-owned immutable artifact selection; browser requests cannot select Host files. */
export interface Config extends RuntimeLimits {
  /** Absolute deployment-owned artifact override; pair with manifestSHA256. */
  readonly artifactDirectory?: string
  /** SHA-256 pin for the override manifest; shipped release index otherwise selects it. */
  readonly manifestSHA256?: string
  /** Positive maximum of Host-lifetime task receipts; oldest settled receipts evict first. */
  readonly maxRetainedTasks: number
}
/** Required release selection and configurable operation budgets. */
export const Config: schema<Config> = schema.object({
  artifactDirectory: schema.string(), manifestSHA256: schema.string(),
  operationTimeoutMs: schema.number().default(300_000), shutdownTimeoutMs: schema.number().default(10_000),
  maxManifestBytes: schema.number().default(16 * 1024 * 1024), maxFileBytes: schema.number().default(512 * 1024 * 1024),
  maxTotalBytes: schema.number().default(4 * 1024 * 1024 * 1024), maxFiles: schema.number().default(100_000),
  maxResponseBytes: schema.number().default(64 * 1024), maxRetainedTasks: schema.number().default(256),
})
