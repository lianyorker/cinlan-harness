/** Apply-owned observation of eligible Workspace execution targets. */
import type { Context } from '@deepseek-ai/cordis'
import type { ListTargetsValue, TargetView } from '@deepseek-ai/dsh-api-execution-host-controller/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Complete live selection observation; unavailable observations offer no remote targets. */
export interface ExecutionTargetsSnapshot {
  readonly available: boolean
  readonly targets: readonly TargetView[]
}

/**
 * Observe the optional generated target namespace through the shared reconnecting carrier.
 * @param ctx - owning plugin Context; service removal clears options and joins the stream.
 * @returns the stable bare source bound by the renderer.
 */
export function executionTargetsSource(ctx: Context) {
  const empty: ExecutionTargetsSnapshot = { available: false, targets: [] }
  const source = createSnapshotStore<ExecutionTargetsSnapshot>(empty)
  ctx.inject(['remote.executionHosts'], (scoped) => {
    const stream = scoped.remote.$stream<ListTargetsValue>({
      name: 'Workspace execution targets',
      open: signal => scoped.remote.executionHosts.follow(signal),
      ended: () => new Error('Workspace execution target observation ended'),
      carrierFailed: () => { source.set(empty) },
    })
    const consume = (async () => {
      try {
        for await (const item of stream) {
          if (stream.signal.aborted) break
          source.set({ available: true, targets: item.value.targets.filter(target =>
            target.execution?.bootstrapPath !== undefined && target.execution.bootstrapHash !== undefined) })
          item.accept()
        }
      } catch (_error) {
        // Unavailable management transports withdraw remote choices until the next accepted observation.
        source.set(empty)
      }
    })()
    scoped.effect(() => async () => {
      source.set(empty)
      await stream.dispose()
      await consume
    })
  })
  return source
}
