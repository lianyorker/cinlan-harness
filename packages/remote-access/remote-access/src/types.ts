/** Browser-safe device grant vocabulary and same-process Desktop carrier capability. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Server-issued identity of one revocable paired credential. */
export type PairedDeviceId = Branded<'paired-device-id'>
/** Server-issued identity of a single-use pairing invitation. */
export type PairingInvitationId = Branded<'pairing-invitation-id'>
/** Independently granted operations on explicitly selected Sessions. */
export type PairingScope = 'session:read' | 'session:send' | 'session:stop' | 'questions:answer' | 'approvals:decide'

/** Explicit authority selected on the trusted Desktop. */
export interface PairingGrant {
  readonly sessionIds: readonly SessionId[]
  readonly scopes: readonly PairingScope[]
}

/** Device metadata safe to display; contains no credential or digest. */
export interface PairedDevice extends PairingGrant {
  readonly deviceId: PairedDeviceId
  readonly displayName: string
  readonly createdAt: number
  readonly expiresAt: number
  readonly revokedAt: number | null
}

/** One-time invitation shown only on the trusted Desktop. */
export interface PairingInvitation extends PairingGrant {
  readonly invitationId: PairingInvitationId
  readonly code: string
  readonly expiresAt: number
}

/** Persisted grant record, validated by this owner after reading credential storage. */
export interface StoredDevice extends PairedDevice {
  readonly schemaVersion: 1
  readonly credentialDigest: string
}

/** Desktop lifecycle capability: dispatch shares the local update lock; assets use a phone bootstrap. */
export interface RemoteAccessHost {
  /**
   * Admit work through the same update lock as local API and stream requests.
   * @param operation - operation to admit before execution.
   * @returns the admitted operation's result.
   */
  dispatch<T>(operation: () => T | Promise<T>): Promise<T>
  /**
   * Serve matching runtime assets with a paired browser bootstrap, never ownsHost:true.
   * @param request - authenticated asset request.
   * @returns the runtime asset, or 404 for an unrecognized path.
   */
  fetchAssets(request: Request): Response | Promise<Response>
}

/** Local management view of listener readiness and durable paired devices. */
export interface RemoteAccessStatus {
  readonly state: 'disabled' | 'not-configured' | 'ready'
  readonly missingConfiguration: readonly ('hostAdapter' | 'advertisedOrigin' | 'tlsCertificatePath' | 'tlsPrivateKeyPath')[]
  readonly origin: string | null
  readonly certificateFingerprint: string | null
  readonly devices: readonly PairedDevice[]
}
