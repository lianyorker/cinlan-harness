/** Apply-owned Remote adaptation; presentation receives values and original failures. */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { HostsCallbacks } from './types.ts'

type UnaryMethod = Exclude<keyof HostsCallbacks, 'follow' | 'followRuntimeTask'>
/** Narrow generated namespace required by the page, with no transport escape hatch. */
export type HostsRemote = {
  [K in UnaryMethod]: (...args: Parameters<HostsCallbacks[K]>) => Promise<RemoteResult<Awaited<ReturnType<HostsCallbacks[K]>>>>
} & Pick<HostsCallbacks, 'follow' | 'followRuntimeTask'>

async function unwrap<T>(result: Promise<RemoteResult<T>>): Promise<T> {
  const settled = await result
  if (!settled.ok) throw settled.error
  return settled.value
}

/**
 * Adapt generated methods without erasing business codes or cancellation.
 * @param remote - executionHosts namespace captured by apply.
 * @returns plain callbacks for the observer and page.
 */
export function createHostsCallbacks(remote: HostsRemote): HostsCallbacks {
  return {
    detectRuntime: (request, signal) => unwrap(remote.detectRuntime(request, signal)),
    startRuntime: (request, signal) => unwrap(remote.startRuntime(request, signal)),
    getRuntimeTask: (request, signal) => unwrap(remote.getRuntimeTask(request, signal)),
    listRuntimeTasks: signal => unwrap(remote.listRuntimeTasks(signal)),
    followRuntimeTask: (request, signal) => remote.followRuntimeTask(request, signal),
    cancelRuntimeTask: (request, signal) => unwrap(remote.cancelRuntimeTask(request, signal)),
    list: signal => unwrap(remote.list(signal)),
    follow: signal => remote.follow(signal),
    create: (request, signal) => unwrap(remote.create(request, signal)),
    update: (request, signal) => unwrap(remote.update(request, signal)),
    removeTarget: (request, signal) => unwrap(remote.removeTarget(request, signal)),
    connect: (request, signal) => unwrap(remote.connect(request, signal)),
    disconnect: (request, signal) => unwrap(remote.disconnect(request, signal)),
    inspectDirectory: (request, signal) => unwrap(remote.inspectDirectory(request, signal)),
  }
}
