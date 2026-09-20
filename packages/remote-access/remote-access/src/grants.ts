/** One-time invitations and durable, individually revocable device credentials. */
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type Credentials from '@deepseek-ai/dsh-credentials'
import { z } from 'zod'
import type { PairedDevice, PairedDeviceId, PairingGrant, PairingInvitation, PairingInvitationId, StoredDevice } from './types.ts'

const grantSchema = z.object({
  sessionIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  scopes: z.array(z.enum(['session:read', 'session:send', 'session:stop', 'questions:answer', 'approvals:decide'])).min(1).max(5),
}).strict().refine(value => value.scopes.includes('session:read'))
const deviceSchema = z.object({
  schemaVersion: z.literal(1), deviceId: z.uuid(), displayName: z.string().min(1).max(80),
  createdAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(),
  revokedAt: z.number().int().nonnegative().nullable(),
  credentialDigest: z.string().regex(/^[a-f0-9]{64}$/),
  sessionIds: z.array(z.string().min(1).max(200)).min(1).max(100),
  scopes: z.array(z.enum(['session:read', 'session:send', 'session:stop', 'questions:answer', 'approvals:decide'])).min(1).max(5),
}).strict()

/** Deployment limits applied to every invitation and issued device credential. */
export interface GrantLimits {
  readonly invitationLifetimeMs: number
  readonly credentialLifetimeMs: number
  readonly maxInvitationAttempts: number
}

interface InvitationState {
  readonly invitation: PairingInvitation
  attempts: number
}

/** Owns the single outstanding Desktop invitation and credential persistence. */
export class PairingGrants {
  private invitation: InvitationState | undefined
  private transaction: Promise<unknown> = Promise.resolve()

  /**
   * @param credentials - durable credential owner; raw bearer material is never stored.
   * @param limits - explicit deployment TTL and attempt limits.
   */
  constructor(private readonly credentials: Pick<Credentials, 'readRecord' | 'modifyRecord' | 'listRecords'>, private readonly limits: GrantLimits) {}

  /**
   * Replace any outstanding invitation with a fresh limited one-time code.
   * @param grant - explicitly selected Sessions and scopes from the trusted Desktop.
   * @returns invitation, including the code displayed only to the local human.
   */
  createInvitation(grant: PairingGrant): PairingInvitation {
    const parsed = grantSchema.parse(grant) as unknown as PairingGrant
    const invitation: PairingInvitation = Object.freeze({
      invitationId: randomUUID() as PairingInvitationId,
      code: randomInt(100_000_000, 1_000_000_000).toString(),
      expiresAt: Date.now() + this.limits.invitationLifetimeMs,
      sessionIds: Object.freeze([...new Set(parsed.sessionIds)]), scopes: Object.freeze([...new Set(parsed.scopes)]),
    })
    this.invitation = { invitation, attempts: 0 }
    return invitation
  }

  /** Invalidate the outstanding code, including during listener shutdown. */
  cancelInvitation(): void { this.invitation = undefined }

  /**
   * Consume the invitation and persist one credential before returning its raw value once.
   * @param value - untrusted HTTPS exchange JSON.
   * @returns the raw credential and safe device metadata after successful persistence.
   */
  exchange(value: unknown): Promise<{ credential: string; device: PairedDevice }> {
    return this.serial(async () => {
      const pending = this.invitation
      if (pending === undefined || pending.invitation.expiresAt <= Date.now()) { this.invitation = undefined; throw new Error('Pairing invitation is unavailable') }
      pending.attempts++
      if (pending.attempts >= this.limits.maxInvitationAttempts) this.invitation = undefined
      const request = z.object({
        invitationId: z.uuid(), code: z.string().regex(/^[0-9]{9}$/),
        displayName: z.string().trim().min(1).max(80), protocolVersion: z.literal(1),
      }).strict().safeParse(value)
      if (!request.success || request.data.invitationId !== pending.invitation.invitationId
        || !equal(request.data.code, pending.invitation.code)) {
        throw new Error('Pairing invitation is unavailable')
      }
      this.invitation = undefined
      const deviceId = randomUUID() as PairedDeviceId
      const credential = deviceId + '.' + randomBytes(32).toString('base64url')
      const record: StoredDevice = {
        schemaVersion: 1, deviceId, displayName: request.data.displayName,
        createdAt: Date.now(), expiresAt: Date.now() + this.limits.credentialLifetimeMs, revokedAt: null,
        scopes: pending.invitation.scopes, sessionIds: pending.invitation.sessionIds,
        credentialDigest: digest(credential),
      }
      const committed = await this.credentials.modifyRecord(deviceKey(deviceId), () => Promise.resolve({ kind: 'grant', payload: record }))
      if (committed?.kind !== 'grant') throw new Error('Device credential was not persisted')
      return { credential, device: metadata(record) }
    })
  }

  /**
   * Authenticate a bearer credential against current durable grant state.
   * @param credential - opaque credential read from the secure cookie.
   * @returns its validated durable grant, absent for invalid, expired or revoked credentials.
   */
  async authenticate(credential: string): Promise<StoredDevice | undefined> {
    const match = /^([a-f0-9-]{36})[.]([A-Za-z0-9_-]{43})$/.exec(credential)
    if (match === null || !z.uuid().safeParse(match[1]).success) return undefined
    const stored = await this.credentials.readRecord(deviceKey(match[1] as PairedDeviceId))
    if (stored?.kind !== 'grant') return undefined
    const parsed = deviceSchema.safeParse(stored.payload)
    if (!parsed.success) return undefined
    const record = parsed.data as unknown as StoredDevice
    if (record.deviceId !== match[1] || record.revokedAt !== null || record.expiresAt <= Date.now()
      || !equal(record.credentialDigest, digest(credential))) return undefined
    return record
  }

  /**
   * Commit a revocation tombstone before the listener invalidates active connections.
   * @param deviceId - local UI-selected paired device.
   */
  async revoke(deviceId: PairedDeviceId): Promise<void> {
    z.uuid().parse(deviceId)
    await this.credentials.modifyRecord(deviceKey(deviceId), (current) => {
      if (current?.kind !== 'grant') return Promise.resolve(current)
      const parsed = deviceSchema.parse(current.payload)
      return Promise.resolve({ kind: 'grant', payload: { ...parsed, revokedAt: parsed.revokedAt ?? Date.now() } })
    })
  }

  /**
   * List paired devices without exposing credential material.
   * @returns durable safe device metadata, including revocation tombstones.
   */
  async list(): Promise<readonly PairedDevice[]> {
    const devices: PairedDevice[] = []
    for (const entry of await this.credentials.listRecords()) {
      if (!entry.key.startsWith('remote-access/device-')) continue
      const record = await this.credentials.readRecord(entry.key)
      if (record?.kind !== 'grant') continue
      const parsed = deviceSchema.safeParse(record.payload)
      if (parsed.success) devices.push(metadata(parsed.data as unknown as StoredDevice))
    }
    return devices.sort((a, b) => b.createdAt - a.createdAt)
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.transaction.then(operation)
    this.transaction = result.catch(() => undefined)
    return result
  }
}

function deviceKey(id: PairedDeviceId) { return credentialKey('remote-access', 'device-' + id) }
function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }
function equal(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
function metadata(record: StoredDevice): PairedDevice {
  return {
    deviceId: record.deviceId, displayName: record.displayName, createdAt: record.createdAt, expiresAt: record.expiresAt,
    revokedAt: record.revokedAt, sessionIds: record.sessionIds, scopes: record.scopes,
  }
}
