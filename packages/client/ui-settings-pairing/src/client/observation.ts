/** Apply-owned management snapshot; invitations are memory-only and expire locally. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { PairedDeviceId, PairingGrant } from '@deepseek-ai/dsh-remote-access/types'
import type { PairingObservation, PairingRemote, PairingSnapshot } from './types.ts'

async function unwrap<T>(result: Promise<RemoteResult<T>>): Promise<T> {
  const settled = await result
  if (!settled.ok) throw settled.error
  return settled.value
}

/**
 * Observe explicit management operations without persisting invitation material.
 * @param remote - official generated pairing namespace on the trusted local carrier.
 * @returns a stable source, serialized human actions and a quiescent disposer.
 */
export function observePairing(remote: PairingRemote): PairingObservation {
  const source = createSnapshotStore<PairingSnapshot>({ status: undefined, invitation: undefined, pending: false, failed: false })
  const lifetime = new AbortController()
  let task: Promise<void> | undefined
  let expiry: ReturnType<typeof setTimeout> | undefined
  const publish = (change: Partial<PairingSnapshot>): void => {
    if (!lifetime.signal.aborted) source.set({ ...source.getSnapshot(), ...change })
  }
  const clearInvitation = (): void => {
    clearTimeout(expiry)
    expiry = undefined
    publish({ invitation: undefined })
  }
  const describe = async (): Promise<void> => {
    const status = await unwrap(remote.describe())
    publish({ status })
    if (status.state !== 'ready') clearInvitation()
  }
  const perform = (action: () => Promise<void>): Promise<void> => {
    if (lifetime.signal.aborted || task !== undefined) return task ?? Promise.resolve()
    publish({ pending: true, failed: false })
    task = Promise.resolve().then(async () => {
      if (!lifetime.signal.aborted) await action()
    }).catch(() => {
      // Remote failures are rendered as localized recovery copy; never log invitation material.
      publish({ failed: true })
    }).finally(() => {
      task = undefined
      publish({ pending: false })
    })
    return task
  }
  const refresh = (): Promise<void> => perform(describe)
  void refresh()
  return {
    source,
    refresh,
    enable: () => perform(async () => { publish({ status: await unwrap(remote.enable()) }) }),
    disable: () => perform(async () => {
      publish({ status: await unwrap(remote.disable()) })
      clearInvitation()
    }),
    createInvitation: (grant: PairingGrant) => perform(async () => {
      if (source.getSnapshot().status?.state !== 'ready' || grant.sessionIds.length === 0 || !grant.scopes.includes('session:read')) return
      const invitation = await unwrap(remote.createInvitation(grant))
      if (lifetime.signal.aborted) return
      clearInvitation()
      publish({ invitation })
      expiry = setTimeout(clearInvitation, Math.max(0, invitation.expiresAt - Date.now()))
    }),
    cancelInvitation: () => perform(async () => {
      await unwrap(remote.cancelInvitation())
      clearInvitation()
    }),
    revokeDevice: (deviceId: PairedDeviceId) => perform(async () => {
      await unwrap(remote.revokeDevice({ deviceId }))
      await describe()
    }),
    dispose: async (): Promise<void> => {
      lifetime.abort()
      clearTimeout(expiry)
      await task
      source.set({ status: undefined, invitation: undefined, pending: false, failed: false })
    },
  }
}
