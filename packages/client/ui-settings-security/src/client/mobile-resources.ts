/** Registration-owned reads of Android resources, connected devices, and mirror processes. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MobileRuntimeStatus } from '@deepseek-ai/dsh-mobile-device-runtime/types'

/** Host observation bound to the resource panel by the renderer. */
export type MobileResourceRead = { status: 'loading' } | { status: 'error' } | { status: 'ready'; value: MobileRuntimeStatus }

/** Observe active tasks and mirror processes while the panel is mounted.
 * @param readStatus - Authoritative read; cancellation releases only this observation.
 * @param pollIntervalMs - Poll interval from plugin configuration.
 * @returns Stable source, watch disposal, explicit refresh, and final disposal.
 */
export function createMobileResourceObserver(readStatus: (signal: AbortSignal) => Promise<MobileRuntimeStatus>, pollIntervalMs: number) {
  const store = createSnapshotStore<MobileResourceRead>({ status: 'loading' })
  let observation: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let watchers = 0
  let disposed = false
  const stop = (): void => { observation?.abort(); observation = undefined; clearTimeout(timer); timer = undefined }
  const read = async (controller: AbortController): Promise<void> => {
    try {
      const value = await readStatus(controller.signal)
      if (controller.signal.aborted) return
      if (value.task?.state === 'running' || value.mirror?.state === 'starting' || value.mirror?.state === 'running') {
        timer = setTimeout(() => { timer = undefined; void read(controller) }, pollIntervalMs)
      }
      store.set({ status: 'ready', value })
    } catch (_statusReadRejected) {
      if (!controller.signal.aborted) store.set({ status: 'error' })
    }
  }
  const refresh = (): void => {
    stop()
    if (disposed || watchers === 0) return
    const controller = new AbortController()
    observation = controller
    store.set({ status: 'loading' })
    if (!controller.signal.aborted) void read(controller)
  }
  const watch = (): (() => void) => {
    if (disposed) return () => {}
    watchers++
    if (watchers === 1) refresh()
    let active = true
    return () => { if (active) { active = false; watchers--; if (watchers === 0) stop() } }
  }
  return { store, watch, refresh, dispose: (): void => { disposed = true; stop() } }
}
