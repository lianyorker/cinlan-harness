import { describe, expect, it, vi } from 'vitest'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { PairingGrants } from '../src/grants.ts'

function setup() {
  const records = new Map<CredentialKey, CredentialRecord>()
  const credentials = {
    async readRecord(key: CredentialKey) { return records.get(key) },
    async listRecords() { return [...records].map(([key, value]) => ({ key, kind: value.kind })) },
    async modifyRecord(key: CredentialKey, mutate: (value: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
      const value = await mutate(records.get(key)); if (value === undefined) records.delete(key); else records.set(key, value); return value
    },
  }
  const limits = { invitationLifetimeMs: 120000, credentialLifetimeMs: 600000, maxInvitationAttempts: 2 }
  const grants = new PairingGrants(credentials, limits)
  return { grants, records, credentials, limits }
}
const grant = { sessionIds: ['original-session' as SessionId], scopes: ['session:read', 'session:send'] as const }

describe('pairing invitation and device persistence', () => {
  it('consumes a code once under concurrent exchange and stores only a digest', async () => {
    const { grants, records } = setup()
    const invite = grants.createInvitation(grant)
    const request = { invitationId: invite.invitationId, code: invite.code, displayName: 'Phone', protocolVersion: 1 }
    const results = await Promise.allSettled([grants.exchange(request), grants.exchange(request)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const result = results.find(result => result.status === 'fulfilled')!
    if (result.status !== 'fulfilled') throw new Error('exchange did not succeed')
    expect(JSON.stringify([...records])).not.toContain(result.value.credential)
    expect(await grants.authenticate(result.value.credential)).toMatchObject(grant)
    expect(await grants.list()).toEqual([result.value.device])
    expect(await grants.authenticate(result.value.credential + 'x')).toBeUndefined()
  })

  it('persists revocation across a new owner instance and never returns credentials in metadata', async () => {
    const { grants, credentials, limits } = setup()
    const invite = grants.createInvitation(grant)
    const paired = await grants.exchange({ invitationId: invite.invitationId, code: invite.code, displayName: 'Phone', protocolVersion: 1 })
    await grants.revoke(paired.device.deviceId)
    const restarted = new PairingGrants(credentials, limits)
    expect(await restarted.authenticate(paired.credential)).toBeUndefined()
    const metadata = await restarted.list()
    expect(metadata[0]?.revokedAt).toEqual(expect.any(Number))
    expect(JSON.stringify(metadata)).not.toContain('credentialDigest')
  })

  it('bounds guesses across malformed requests and rejects expired invitations', async () => {
    const { grants } = setup()
    const invite = grants.createInvitation(grant)
    await expect(grants.exchange({})).rejects.toThrow('unavailable')
    await expect(grants.exchange({})).rejects.toThrow('unavailable')
    await expect(grants.exchange({ invitationId: invite.invitationId, code: invite.code, displayName: 'Phone', protocolVersion: 1 })).rejects.toThrow('unavailable')
    const clock = vi.spyOn(Date, 'now')
    try {
      clock.mockReturnValue(1000)
      const expired = grants.createInvitation(grant)
      clock.mockReturnValue(expired.expiresAt)
      await expect(grants.exchange({ invitationId: expired.invitationId, code: expired.code, displayName: 'Phone', protocolVersion: 1 })).rejects.toThrow('unavailable')
    } finally { clock.mockRestore() }
  })

  it('does not issue a credential when persistence fails and requires read scope', async () => {
    const { grants, credentials } = setup()
    expect(() => grants.createInvitation({ sessionIds: grant.sessionIds, scopes: ['session:send'] })).toThrow()
    const invite = grants.createInvitation(grant)
    const modify = vi.spyOn(credentials, 'modifyRecord').mockRejectedValue(new Error('storage failed'))
    await expect(grants.exchange({ invitationId: invite.invitationId, code: invite.code, displayName: 'Phone', protocolVersion: 1 })).rejects.toThrow('storage failed')
    modify.mockRestore()
    expect(await grants.list()).toEqual([])
    await expect(grants.exchange({ invitationId: invite.invitationId, code: invite.code, displayName: 'Phone', protocolVersion: 1 })).rejects.toThrow('unavailable')
  })
})
