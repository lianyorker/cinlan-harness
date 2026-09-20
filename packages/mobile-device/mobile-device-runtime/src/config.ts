/** Validated private storage and explicit network policy for Android resources. */
import z from '@deepseek-ai/schemastery'
import { resolve } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { Config as Options } from './types.ts'
/** Loader configuration; proxy use is explicit and never imported from system settings. */
export const Config: z<Options> = z.object({
  storageDir: z.string().default(dshHomePath('mobile', 'runtime')),
  commandTimeoutMs: z.number().default(10000), installTimeoutMs: z.number().default(600000),
  processGraceMs: z.number().default(3000), maxOutputBytes: z.number().default(65536),
  maxExpandedBytes: z.number().default(256 * 1024 * 1024), maxArchiveFiles: z.number().default(1024),
  lockWaitMs: z.number().default(3000), mirrorPollMs: z.number().default(1000), downloadProxyUrl: z.string().default(''),
})
/** Validate deployment limits before registering a manager.
 * @param input - Loader values.
 * @returns Explicit bounded execution and storage choices.
 */
export function resolveConfig(input: Options = {}): Required<Options> {
  const allowed = new Set(Object.keys(Config({})))
  if (Object.keys(input).some(key => !allowed.has(key))) throw new Error('Unsupported mobile runtime configuration')
  const config = Config(input) as Required<Options>
  for (const value of Object.values(config)) {
    if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647)) throw new Error('Invalid mobile runtime bound')
  }
  if (!config.storageDir.trim()) throw new Error('Mobile runtime storage directory is required')
  if (config.downloadProxyUrl) {
    const url = new URL(config.downloadProxyUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid explicit mobile download proxy')
  }
  return { ...config, storageDir: resolve(config.storageDir) }
}
