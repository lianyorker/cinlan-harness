/** Apply-owned Remote adaptation; presentation receives values and original failures. */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { HostsCallbacks, TargetCallbacks } from './types.ts'

type UnaryMethod = Exclude<keyof TargetCallbacks, 'follow'>
/** Narrow generated namespace required by the page, with no transport escape hatch. */
export type HostsRemote = {
  [K in UnaryMethod]: (...args: Parameters<TargetCallbacks[K]>) => Promise<RemoteResult<Awaited<ReturnType<TargetCallbacks[K]>>>>
} & Pick<TargetCallbacks, 'follow'>

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
    list: signal => unwrap(remote.list(signal)),
    follow: signal => remote.follow(signal),
    create: (request, signal) => unwrap(remote.create(request, signal)),
    update: (request, signal) => unwrap(remote.update(request, signal)),
    removeTarget: (request, signal) => unwrap(remote.removeTarget(request, signal)),
    connect: (request, signal) => unwrap(remote.connect(request, signal)),
    disconnect: (request, signal) => unwrap(remote.disconnect(request, signal)),
    test: (request, signal) => unwrap(remote.test(request, signal)),
    listImportableHosts: signal => unwrap(remote.listImportableHosts(signal)),
  }
}
