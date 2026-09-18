/** Stdio execution-host worker plugin; stdout is reserved for protocol frames. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-cmdline'
import { resolveConfig } from './config.ts'
import type { WorkerConfig } from './config.ts'
import { createWorkerTransport } from './protocol.ts'
import { WorkerServer } from './server.ts'

export { Config } from './config.ts'
export type { WorkerConfig } from './config.ts'

export const name = 'execution-host-worker'
export const inject = ['executionHost', 'fs', 'subprocess']

/**
 * Serve only after launcher startup commits. EOF and protocol shutdown request
 * launcher-owned exit after operations settle; shutdown also flushes its response.
 * @param ctx - Worker context carrying providers and launcher readiness/exit services.
 * @param config - Explicit roots, validated bounds, and source-test stream overrides.
 * @returns Root validation and registration of the serving effect.
 */
export async function apply(ctx: Context, config: WorkerConfig): Promise<void> {
  const ready = ctx.get('appReady')
  const exit = ctx.get('appExit')
  if (ready === undefined || exit === undefined) {
    throw new Error('execution-host-worker: the launcher must provide ctx.appReady and ctx.appExit')
  }
  const resolved = resolveConfig(config)
  const server = new WorkerServer(ctx, resolved)
  await server.prepare()
  const transport = createWorkerTransport(config.input ?? process.stdin, config.output ?? process.stdout, resolved.maxFrameBytes)
  ctx.effect(() => {
    let disposed = false
    let exitTask: Promise<void> | undefined
    let shutdownImmediate: NodeJS.Immediate | undefined
    const requestExit = (flush: boolean): Promise<void> => {
      exitTask ??= (async () => {
        await server.dispose()
        if (flush) await transport.flush()
        if (!disposed) exit(0)
      })().catch(() => {
        if (!disposed) exit(1)
      })
      return exitTask
    }
    transport.onRequest(async (method, params) => {
      const result = await server.handle(method, params)
      if (method === 'shutdown' && result.ok) {
        shutdownImmediate = setImmediate(() => {
          if (!disposed) void requestExit(true)
        })
      }
      return result
    })
    const cancelReady = ready.onReady(() => {
      transport.start()
      void transport.closed.then(() => {
        if (!disposed) return requestExit(false)
      })
    })
    return async () => {
      disposed = true
      cancelReady()
      if (shutdownImmediate !== undefined) clearImmediate(shutdownImmediate)
      transport.close()
      await server.dispose()
    }
  }, 'execution-host-worker.serve')
}
