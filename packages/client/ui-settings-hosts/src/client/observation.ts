/** Private complete-snapshot observation; stream frames outrank overlapping list reads. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostsCallbacks, HostsSnapshot } from './types.ts'
import { hostDiagnostic } from './diagnostics.ts'

/**
 * Follow Host state until disposal, and expose explicit conflict/retry refresh.
 * @param callbacks - unwrapped list and follow operations.
 * @returns a renderer-bindable source, refresh callback and awaited disposer.
 */
export function observeHosts(callbacks: Pick<HostsCallbacks, 'list' | 'follow'>) {
  const source = createSnapshotStore<HostsSnapshot>({ status: 'loading', value: undefined, error: undefined })
  const lifetime = new AbortController()
  let observation = 0
  let stream: Promise<void> | undefined
  const consume = async (): Promise<void> => {
    try {
      for await (const value of callbacks.follow(lifetime.signal)) {
        if (lifetime.signal.aborted) return
        observation++
        source.set({ status: 'ready', value, error: undefined })
      }
      if (!lifetime.signal.aborted) {
        observation++
        source.set({ status: 'error', value: source.getSnapshot().value,
          error: { code: 'execution-host/connection-lost', message: '' } })
      }
    } catch (error) {
      if (!lifetime.signal.aborted) {
        observation++
        source.set({ status: 'error', value: source.getSnapshot().value, error: hostDiagnostic(error) })
      }
    }
  }
  const start = (): void => {
    if (stream !== undefined || lifetime.signal.aborted) return
    source.set({ ...source.getSnapshot(), status: 'loading', error: undefined })
    stream = consume().finally(() => { stream = undefined })
  }
  start()
  return {
    source,
    refresh: async (signal?: AbortSignal) => {
      const ticket = observation
      const value = await callbacks.list(signal ?? lifetime.signal)
      if (!lifetime.signal.aborted) {
        if (ticket === observation) source.set({ status: 'ready', value, error: undefined })
        start()
      }
      return source.getSnapshot().value ?? value
    },
    dispose: async (): Promise<void> => {
      lifetime.abort()
      await stream
    },
  }
}
