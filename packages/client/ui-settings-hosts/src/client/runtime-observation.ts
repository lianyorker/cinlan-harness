/** Renderer-independent task receipt recovery; disposal detaches observers without cancelling Host tasks. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RuntimeTask, RuntimeTaskId, RuntimeStartRequest, RuntimeTaskRequest } from '@deepseek-ai/dsh-api-execution-host-controller/types'
import type { RuntimeCallbacks, RuntimesSnapshot } from './types.ts'
import { hostDiagnostic } from './diagnostics.ts'

/**
 * Recover and follow bounded Host task observations across settings page remounts.
 * @param callbacks - Generated Remote operations with unwrapped success values.
 * @returns a framework source, explicit mutations, refresh and joined observer disposal.
 */
export function observeRuntimes(callbacks: RuntimeCallbacks) {
  const source = createSnapshotStore<RuntimesSnapshot>({ status: 'loading', tasks: [], error: undefined })
  const lifetime = new AbortController()
  const streams = new Map<RuntimeTaskId, Promise<void>>()
  const operations = new Set<Promise<unknown>>()
  let version = 0
  const accept = (task: RuntimeTask): void => {
    if (lifetime.signal.aborted) return
    const previous = source.getSnapshot().tasks.find(value => value.id === task.id)
    if (previous !== undefined && previous.state !== 'running' && task.state === 'running') return
    version++
    const tasks = [...source.getSnapshot().tasks.filter(value => value.id !== task.id), task]
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    source.set({ status: 'ready', tasks, error: undefined })
  }
  const watch = (task: RuntimeTask): void => {
    if (task.state !== 'running' || streams.has(task.id) || lifetime.signal.aborted) return
    const done = (async () => {
      try {
        for await (const value of callbacks.followRuntimeTask({ id: task.id }, lifetime.signal)) {
          accept(value.task)
          if (value.task.state !== 'running') return
        }
        if (!lifetime.signal.aborted) throw new Error('Runtime task observation ended before settlement')
      } catch (error) {
        if (!lifetime.signal.aborted) source.set({ ...source.getSnapshot(), status: 'error', error: hostDiagnostic(error) })
      }
    })().finally(() => { streams.delete(task.id) })
    streams.set(task.id, done)
  }
  const track = <T>(operation: Promise<T>): Promise<T> => {
    operations.add(operation)
    void operation.then(() => operations.delete(operation), () => operations.delete(operation))
    return operation
  }
  const refresh = (): Promise<void> => track((async () => {
    const ticket = version
    const value = await callbacks.listRuntimeTasks(lifetime.signal)
    if (lifetime.signal.aborted) return
    if (ticket === version) source.set({ status: 'ready', tasks: value.tasks, error: undefined })
    for (const task of source.getSnapshot().tasks) watch(task)
  })())
  void refresh().catch((error: unknown) => {
    if (!lifetime.signal.aborted) source.set({ ...source.getSnapshot(), status: 'error', error: hostDiagnostic(error) })
  })
  return {
    source, refresh,
    start: (request: RuntimeStartRequest) => track((async () => {
      const value = await callbacks.startRuntime(request, lifetime.signal)
      accept(value.task); watch(value.task)
      return value
    })()),
    cancel: (request: RuntimeTaskRequest) => track((async () => {
      const value = await callbacks.cancelRuntimeTask(request, lifetime.signal)
      accept(value.task)
      return value
    })()),
    dispose: async (): Promise<void> => {
      lifetime.abort()
      await Promise.allSettled([...streams.values(), ...operations])
    },
  }
}
