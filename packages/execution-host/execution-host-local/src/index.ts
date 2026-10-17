/** Local execution host provider. */

import { Context } from '@deepseek-ai/cordis'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { ExecutionHostService, ExecutionHostId } from '@deepseek-ai/dsh-execution-host'
import type { ExecutionHostInfo } from '@deepseek-ai/dsh-execution-host'

/**
 * Operator override for the local host identity.
 *
 * The default remains a per-process random id. A static assessment grant can
 * never name that id, so an operator who needs a durable
 * `assessment-scope` `executionHostIds` entry pins this host id instead.
 */
export interface Config {
  /** Stable host id; omission keeps the per-process random id. */
  readonly hostId?: string
}

/** Environment variables consulted, in order, when no `hostId` is configured. */
const HOST_ID_ENV_KEYS = ['CLH_EXECUTION_HOST_ID', 'DSH_EXECUTION_HOST_ID'] as const

function pinnedHostId(config: Config): string | undefined {
  const candidates: (string | undefined)[] = [config.hostId, ...HOST_ID_ENV_KEYS.map(key => process.env[key])]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim()
  }
  return undefined
}

/** Local execution host provider using process identity. */
export default class ExecutionHostLocal extends ExecutionHostService {
  private readonly info: ExecutionHostInfo

  /**
   * @param ctx - Cordis context owning the service.
   * @param config - Optional pinned host id.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    this.info = {
      hostId: ExecutionHostId(pinnedHostId(config) ?? `local-${randomUUID()}`),
      hostname: hostname(),
      pid: process.pid,
      platform: process.platform,
      createdAt: new Date().toISOString(),
    }
  }

  current(): ExecutionHostInfo {
    return this.info
  }
}

export const name = 'execution-host-local'
export function apply(ctx: Context, config: Config = {}): void {
  ctx.plugin(ExecutionHostLocal, config)
}
