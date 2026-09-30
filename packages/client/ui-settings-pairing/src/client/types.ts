import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Server-issued identity of one revocable paired credential. */
export type PairedDeviceId = string & { readonly __brand?: 'paired-device-id' }
/** Server-issued identity of a single-use pairing invitation. */
export type PairingInvitationId = string & { readonly __brand?: 'pairing-invitation-id' }
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

/** Local management view of listener readiness and durable paired devices. */
export interface RemoteAccessStatus {
  readonly state: 'disabled' | 'not-configured' | 'ready'
  readonly missingConfiguration: readonly ('hostAdapter' | 'advertisedOrigin' | 'tlsCertificatePath' | 'tlsPrivateKeyPath')[]
  readonly origin: string | null
  readonly certificateFingerprint: string | null
  readonly devices: readonly PairedDevice[]
}

/** Official generated Remote namespace; declared here to decouple from host typert artifact. */
export interface PairingRemote {
  describe(signal?: AbortSignal): Promise<RemoteResult<RemoteAccessStatus>>
  enable(signal?: AbortSignal): Promise<RemoteResult<RemoteAccessStatus>>
  disable(signal?: AbortSignal): Promise<RemoteResult<RemoteAccessStatus>>
  createInvitation(request: PairingGrant, signal?: AbortSignal): Promise<RemoteResult<PairingInvitation>>
  cancelInvitation(signal?: AbortSignal): Promise<RemoteResult<void>>
  revokeDevice(request: { readonly deviceId: PairedDeviceId }, signal?: AbortSignal): Promise<RemoteResult<void>>
}

declare module '@deepseek-ai/dsh-api-remotes/client' {
  interface ClientRemote {
    pairing: PairingRemote
  }
}
/** Last confirmed management state and one transient invitation. */
export interface PairingSnapshot {
  readonly status: RemoteAccessStatus | undefined
  readonly invitation: PairingInvitation | undefined
  readonly pending: boolean
  readonly failed: boolean
}
/** Apply-owned callbacks and framework-bound observable sources. */
export interface PairingInjected {
  hooks: { pairing: ObservableSnapshot<PairingSnapshot>; pairingSessions: ISessions['list'] }
  refresh(): Promise<void>
  enable(): Promise<void>
  disable(): Promise<void>
  createInvitation(grant: PairingGrant): Promise<void>
  cancelInvitation(): Promise<void>
  revokeDevice(deviceId: PairedDeviceId): Promise<void>
}
/** Apply-owned observation source, management callbacks, and disposal. */
export interface PairingObservation extends Omit<PairingInjected, 'hooks'> {
  readonly source: ObservableSnapshot<PairingSnapshot>
  /** Stop publication, await pending requests up to their local deadline, and clear transient invitation data.
   * @returns settlement after the bounded pending operation and source cleanup.
   */
  dispose: () => Promise<void>
}
/** Settings component inputs derived from its registration. */
export type PairingProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.pairing'> & InjectFace<PairingInjected>
