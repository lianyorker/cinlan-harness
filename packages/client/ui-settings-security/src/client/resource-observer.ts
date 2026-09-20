/** One observable view of Host resource snapshots; observation never owns mutations. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SecurityResourceAvailability } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Read state for the registered resource hook, with no derived installation inventory. */
export type SecurityResourceRead =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; value: SecurityResourceAvailability }

/** Only the generated resource observation methods are retained by this adapter. */
type ResourceReader = Pick<Context['remote']['securityResearch'], 'observeResources'>

/** Factory for the single resource snapshot source bound by the slot renderer.
 * @param remote - Generated resource observations.
 * @returns The snapshot source and observation-only lifetime controls.
 */
export function createSecurityResourceObserver(remote: ResourceReader) {
  const store = createSnapshotStore<SecurityResourceRead>({ status: 'loading' })
  let observation: AbortController | undefined
  let subscribers = 0

  const stop = (): void => { observation?.abort(); observation = undefined }
  const read = async (controller: AbortController): Promise<void> => {
    try {
      for await (const frame of remote.observeResources(controller.signal)) {
        if (controller.signal.aborted) return
        store.set({ status: 'ready', value: frame })
      }
      if (!controller.signal.aborted) store.set({ status: 'error' })
    } catch (_observationDisconnected) {
      if (!controller.signal.aborted) store.set({ status: 'error' })
    }
  }
  const refresh = (): void => {
    stop()
    if (subscribers === 0) return
    store.set({ status: 'loading' })
    observation = new AbortController()
    void read(observation)
  }
  const watch = (): (() => void) => {
    subscribers += 1
    if (subscribers === 1) refresh()
    let active = true
    return () => {
      if (!active) return
      active = false
      subscribers -= 1
      if (subscribers === 0) stop()
    }
  }
  return { store, watch, refresh, dispose: stop }
}
