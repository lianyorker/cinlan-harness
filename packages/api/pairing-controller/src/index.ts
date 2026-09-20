/** Local-only Remote management of same-Host phone pairing. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-remote-access'
import type { PairedDeviceId, PairingGrant, PairingInvitation, RemoteAccessStatus } from '@deepseek-ai/dsh-remote-access/types'

declare module '@deepseek-ai/cordis' { interface Context { pairingController: PairingController } }

/** Trusted-local management only; the remoteAccess executor verifies current carrier authority. */
export default class PairingController extends TypertRemoteService {
  static inject = ['typert', 'remoteAccess']

  /** @param ctx - Host Context containing the pairing lifecycle owner. */
  constructor(ctx: Context) { super(ctx, 'pairingController', { namespace: 'pairing' }) }

  /**
   * Read local listener readiness and safe device metadata.
   * @returns listener readiness and paired device metadata without credentials.
   */
  @Remote('describe')
  describe(): Promise<RemoteAccessStatus> { return this.ctx.remoteAccess.describe() }

  /**
   * Enable the explicitly configured HTTPS listener.
   * @returns readiness after explicitly enabling the configured HTTPS carrier.
   */
  @Remote('enable')
  enable(): Promise<RemoteAccessStatus> { return this.ctx.remoteAccess.enable() }

  /**
   * Disable the listener and settle its active carriers.
   * @returns readiness after disabling and draining the carrier.
   */
  @Remote('disable')
  disable(): Promise<RemoteAccessStatus> { return this.ctx.remoteAccess.disable() }

  /**
   * Create a bounded one-time invitation from explicitly selected Session references and scopes.
   * @param request - local human's selected grant.
   * @returns the invitation, shown only on the trusted Desktop.
   */
  @Remote('createInvitation')
  createInvitation(request: PairingGrant): PairingInvitation { return this.ctx.remoteAccess.createInvitation(request) }

  /** Cancel the outstanding pairing invitation. */
  @Remote('cancelInvitation')
  cancelInvitation(): void { this.ctx.remoteAccess.cancelInvitation() }

  /**
   * Revoke a device durably and terminate its current carrier operations.
   * @param request - paired device selected by the local human.
   */
  @Remote('revokeDevice')
  revokeDevice(request: { readonly deviceId: PairedDeviceId }): Promise<void> {
    return this.ctx.remoteAccess.revokeDevice(request.deviceId)
  }
}
