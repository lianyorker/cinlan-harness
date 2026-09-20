/** Pairing presentation uses owner DTOs and the existing Session list source. */
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-pairing-controller/remote'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PairedDeviceId, PairingGrant, PairingInvitation, RemoteAccessStatus } from '@deepseek-ai/dsh-remote-access/types'

/** Official generated Remote namespace; no locally maintained transport DTOs. */
export type PairingRemote = ClientRemote['pairing']
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
  /** Stop publication, await pending requests, and clear transient invitation data.
   * @returns settlement after the pending operation and source cleanup.
   */
  dispose: () => Promise<void>
}
/** Settings component inputs derived from its registration. */
export type PairingProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.pairing'> & InjectFace<PairingInjected>
