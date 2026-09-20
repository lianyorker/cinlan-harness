/** Registration-owned observation of native Browser runtime state. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { BrowserRuntimeStatus } from '@deepseek-ai/dsh-browser-playwright/types'

/** Read state bound to the Browser resource panel by the slot renderer. */
export type BrowserResourceRead =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; value: BrowserRuntimeStatus }

/** Observe Host runtime status while a panel is mounted, polling only active tasks.
 * @param readStatus - Unwrapped runtimeStatus callback; abort cancels the read, never the Host task.
 * @param pollIntervalMs - Positive polling interval supplied by the plugin configuration.
 * @returns Stable snapshot source and observation lifetime controls.
 */
export function createBrowserResourceObserver(
  readStatus: (signal: AbortSignal) => Promise<BrowserRuntimeStatus>,
  pollIntervalMs: number,
): {
  store: ReturnType<typeof createSnapshotStore<BrowserResourceRead>>
  watch: () => () => void
  refresh: () => void
  dispose: () => void
} {
  const store = createSnapshotStore<BrowserResourceRead>({ status: 'loading' })
  let observation: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let subscribers = 0
  let disposed = false

  const stop = (): void => {
    observation?.abort()
    observation = undefined
    clearTimeout(timer)
    timer = undefined
  }
  const read = async (controller: AbortController): Promise<void> => {
    try {
      const value = await readStatus(controller.signal)
      if (controller.signal.aborted) return
      if (value.task?.state === 'running') {
        timer = setTimeout(() => { timer = undefined; void read(controller) }, pollIntervalMs)
      }
      store.set({ status: 'ready', value })
    } catch (_runtimeReadRejected) {
      if (!controller.signal.aborted) store.set({ status: 'error' })
    }
  }
  const refresh = (): void => {
    stop()
    if (disposed || subscribers === 0) return
    const controller = new AbortController()
    observation = controller
    store.set({ status: 'loading' })
    if (!controller.signal.aborted) void read(controller)
  }
  const watch = (): (() => void) => {
    if (disposed) return () => {}
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
  const dispose = (): void => { disposed = true; stop() }
  return { store, watch, refresh, dispose }
}
