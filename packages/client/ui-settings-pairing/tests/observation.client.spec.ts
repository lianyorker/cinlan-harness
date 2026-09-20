/** Pairing expiry, rejected operations, and disposal are owned by the apply observer. */
import { afterEach, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { PairingGrant, PairingInvitation, RemoteAccessStatus } from '@deepseek-ai/dsh-remote-access/types'
import { observePairing } from '../src/client/observation.ts'
import type { PairingRemote } from '../src/client/types.ts'

const disposers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  vi.useRealTimers()
})
const grant: PairingGrant = { sessionIds: ['session-1' as PairingGrant['sessionIds'][number]], scopes: ['session:read'] }
function fixture() {
  const status: RemoteAccessStatus = { state: 'ready', missingConfiguration: [], origin: 'https://desktop.example', certificateFingerprint: 'AA', devices: [] }
  const ok = <T>(value: T) => ({ ok: true as const, value })
  const remote: PairingRemote = {
    describe: vi.fn(async () => ok(status)), enable: vi.fn(async () => ok(status)),
    disable: vi.fn(async () => ok({ ...status, state: 'disabled' as const })),
    createInvitation: vi.fn(async request => ok({ ...request, invitationId: 'invite-1' as PairingInvitation['invitationId'], code: '123456', expiresAt: Date.now() + 1000 })),
    cancelInvitation: vi.fn(async () => ok(undefined)), revokeDevice: vi.fn(async () => ok(undefined)),
  }
  const observer = observePairing(remote)
  disposers.push(observer.dispose)
  return { observer, remote, status, ok }
}

it('expires an invitation without sending a management write', async () => {
  vi.useFakeTimers()
  const b = fixture()
  await b.observer.refresh()
  await b.observer.createInvitation(grant)
  expect(b.observer.source.getSnapshot().invitation?.code).toBe('123456')
  await vi.advanceTimersByTimeAsync(1000)
  expect(b.observer.source.getSnapshot().invitation).toBeUndefined()
  expect(b.remote.cancelInvitation).not.toHaveBeenCalled()
})

it('rejects empty or unreadable grants locally and never creates while disabled', async () => {
  const b = fixture()
  await b.observer.refresh()
  await b.observer.createInvitation({ sessionIds: [], scopes: ['session:read'] })
  await b.observer.createInvitation({ ...grant, scopes: [] })
  await b.observer.disable()
  await b.observer.createInvitation(grant)
  expect(b.remote.createInvitation).not.toHaveBeenCalled()
  await b.observer.enable()
  await b.observer.createInvitation(grant)
  expect(b.remote.createInvitation).toHaveBeenCalledTimes(1)
  await b.observer.cancelInvitation()
  expect(b.observer.source.getSnapshot().invitation).toBeUndefined()
})

it('waits for in-flight operations before disposal and never republishes a late invitation', async () => {
  const b = fixture()
  await b.observer.refresh()
  let resolve!: (value: Awaited<ReturnType<PairingRemote['createInvitation']>>) => void
  b.remote.createInvitation = vi.fn(() => new Promise<Awaited<ReturnType<PairingRemote['createInvitation']>>>((accept) => { resolve = accept }))
  const creating = b.observer.createInvitation(grant)
  await Promise.resolve()
  await Promise.resolve()
  const duplicate = b.observer.createInvitation(grant)
  const disposal = b.observer.dispose()
  resolve(b.ok({ ...grant, invitationId: 'late' as PairingInvitation['invitationId'], code: '654321', expiresAt: Date.now() + 1000 }))
  await Promise.all([creating, duplicate, disposal])
  expect(b.remote.createInvitation).toHaveBeenCalledTimes(1)
  expect(b.observer.source.getSnapshot()).toEqual({ status: undefined, invitation: undefined, pending: false, failed: false })
  await b.observer.enable()
  expect(b.remote.enable).not.toHaveBeenCalled()
})

it('preserves a confirmed invitation after refused cancellation and clears it on disabled refresh', async () => {
  const b = fixture()
  await b.observer.refresh()
  await b.observer.createInvitation(grant)
  b.remote.cancelInvitation = async () => ({ ok: false, error: new RemoteError('gateway/internal', 'private diagnostic', {}) })
  await b.observer.cancelInvitation()
  expect(b.observer.source.getSnapshot().failed).toBe(true)
  expect(b.observer.source.getSnapshot().invitation).toBeDefined()
  b.remote.describe = async () => b.ok({ ...b.status, state: 'disabled' })
  await b.observer.refresh()
  expect(b.observer.source.getSnapshot().invitation).toBeUndefined()
  expect(b.observer.source.getSnapshot().failed).toBe(false)
})
