/** Opt-in direct HTTPS pairing into the existing Desktop Host and Session owners. */
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-api-gateway'
import { Config, type ResolvedConfig } from './config.ts'
import { PairingGrants } from './grants.ts'
import { PairingListener } from './listener.ts'
import type { PairedDeviceId, PairingGrant, PairingInvitation, RemoteAccessHost, RemoteAccessStatus } from './types.ts'
export { Config } from './config.ts'
export type { RemoteAccessHost, RemoteAccessStatus, PairedDevice, PairedDeviceId, PairingScope, PairingGrant, PairingInvitation, PairingInvitationId } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    remoteAccess: RemoteAccess
    remoteAccessHost: RemoteAccessHost
  }
}

/** Listener and paired-device lifecycle; management methods require a trusted local Gateway invocation. */
export default class RemoteAccess extends Service {
  static inject = ['credentials', 'connection', 'typertGateway']
  static Config = Config
  private readonly grants: PairingGrants
  private listener: PairingListener | undefined
  private host: RemoteAccessHost | undefined
  private enabled: boolean
  private transaction: Promise<unknown> = Promise.resolve()
  private disposed = false
  private readonly config: ResolvedConfig

  /**
   * @param ctx - same Desktop Host Context, including its credential and Session dispatchers.
   * @param config - explicitly resolved opt-in TLS deployment settings.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'remoteAccess')
    this.config = Config(config) as ResolvedConfig
    this.enabled = this.config.enabled
    this.grants = new PairingGrants(ctx.credentials, this.config)
    ctx.inject(['remoteAccessHost'], (hostCtx) => {
      hostCtx.effect(async () => {
        this.host = hostCtx.remoteAccessHost
        await this.serial(() => this.reconcile())
        return async () => { this.host = undefined; await this.serial(() => this.stop()) }
      })
    })
    ctx.on('credentials/record-updated', (key) => {
      if (!key.startsWith('remote-access/device-')) return
      this.listener?.revoke(key.slice('remote-access/device-'.length) as PairedDeviceId)
    })
    ctx.effect(() => async () => {
      this.disposed = true
      this.enabled = false
      await this.serial(() => this.stop())
    })
  }

  /**
   * Read local listener readiness and safe device metadata.
   * @returns listener readiness, verified certificate fingerprint and safe paired-device metadata.
   */
  async describe(): Promise<RemoteAccessStatus> { this.assertLocal(); return this.status() }

  /**
   * Enable the explicitly configured HTTPS listener.
   * @returns readiness after explicitly enabling the configured HTTPS listener.
   */
  async enable(): Promise<RemoteAccessStatus> {
    this.assertLocal()
    return this.serial(async () => { this.enabled = true; await this.reconcile(); return this.status() })
  }

  /**
   * Disable the listener and settle its active carriers.
   * @returns disabled state after every network request and stream has settled.
   */
  async disable(): Promise<RemoteAccessStatus> {
    this.assertLocal()
    return this.serial(async () => { this.enabled = false; await this.stop(); return this.status() })
  }

  /**
   * Select exact Session references and scopes for one short-lived pairing code.
   * @param grant - local UI-selected grant.
   * @returns one-time invitation displayed only on the trusted Desktop.
   */
  createInvitation(grant: PairingGrant): PairingInvitation {
    this.assertLocal()
    if (this.listener === undefined) throw new Error('Configure and enable HTTPS before creating a pairing invitation')
    return this.grants.createInvitation(grant)
  }

  /** Invalidate the current one-time invitation. */
  cancelInvitation(): void { this.assertLocal(); this.grants.cancelInvitation() }

  /**
   * Persist revocation before terminating this device's active requests and streams.
   * @param deviceId - paired device selected on the trusted Desktop.
   */
  async revokeDevice(deviceId: PairedDeviceId): Promise<void> {
    this.assertLocal()
    await this.grants.revoke(deviceId)
    this.listener?.revoke(deviceId)
  }

  private assertLocal(): void {
    const access = this.ctx.typertGateway.currentAccess()
    if (access?.kind !== 'trusted-local' || access.signal.aborted || this.disposed) throw new Error('Pairing management requires an authenticated local Desktop request')
  }

  private async status(): Promise<RemoteAccessStatus> {
    const missingConfiguration: Array<RemoteAccessStatus['missingConfiguration'][number]> = []
    if (this.host === undefined) missingConfiguration.push('hostAdapter')
    if (!this.config.advertisedOrigin) missingConfiguration.push('advertisedOrigin')
    if (!this.config.tlsCertificatePath) missingConfiguration.push('tlsCertificatePath')
    if (!this.config.tlsPrivateKeyPath) missingConfiguration.push('tlsPrivateKeyPath')
    return {
      state: !this.enabled ? 'disabled' : this.listener === undefined ? 'not-configured' : 'ready',
      missingConfiguration, origin: this.listener?.origin ?? null,
      certificateFingerprint: this.listener?.certificateFingerprint ?? null, devices: await this.grants.list(),
    }
  }

  private async reconcile(): Promise<void> {
    if (!this.enabled || this.disposed) { await this.stop(); return }
    if (this.listener !== undefined || this.host === undefined || !this.config.advertisedOrigin
      || !this.config.tlsCertificatePath || !this.config.tlsPrivateKeyPath) return
    const listener = new PairingListener(this.config, this.host, this.ctx.connection, this.ctx.typertGateway, this.grants)
    try { await listener.start() } catch (error) { await listener.close(); throw error }
    this.listener = listener
  }

  private async stop(): Promise<void> { const listener = this.listener; this.listener = undefined; await listener?.close() }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.transaction.then(operation)
    this.transaction = result.catch(() => undefined)
    return result
  }
}
