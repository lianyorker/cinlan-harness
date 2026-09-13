/** Local execution host provider. */

import { Context } from '@deepseek-ai/cordis'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { ExecutionHostService, ExecutionHostId } from '@deepseek-ai/dsh-execution-host'
import type { ExecutionHostInfo } from '@deepseek-ai/dsh-execution-host'

/** Local execution host provider using process identity. */
export default class ExecutionHostLocal extends ExecutionHostService {
  private readonly info: ExecutionHostInfo

  constructor(ctx: Context) {
    super(ctx)
    this.info = {
      hostId: ExecutionHostId(`local-${randomUUID()}`),
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
export function apply(ctx: Context): void {
  ctx.plugin(ExecutionHostLocal)
}
