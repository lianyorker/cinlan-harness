/** Cell control admission and connection-bound opaque data forwarding. */
import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'
import { z } from 'zod'
import { digest, hostIdentity, randomSecret, verifyProof } from './crypto.ts'
import { ConnectionIdSchema, DeviceIdSchema, HostIdSchema, ProofSchema, type DeviceId, type HostId } from './mobile-protocol.ts'
import { verifyLease } from './director.ts'
import type { RelayConfig } from './config.ts'

interface Host {
  control: WebSocket
  epoch: number
  expiresAt: number
  publicKey: string
  devices: Map<DeviceId, string>
  queue: Promise<void>
  queued: number
  requests: number
  rateExpiresAt: number
}
interface Tunnel { hostId: HostId; deviceId: DeviceId; ticketHash: string; phone: WebSocket; data?: WebSocket; deadline: ReturnType<typeof setTimeout> }
const CredentialSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const HostControlSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('invite-create'), reqId: z.string().max(128), deviceId: DeviceIdSchema }).strict(),
  z.object({ type: z.literal('device-install'), reqId: z.string().max(128), deviceId: DeviceIdSchema, hash: z.string().length(86) }).strict(),
  z.object({ type: z.literal('device-revoke'), reqId: z.string().max(128), deviceId: DeviceIdSchema }).strict(),
  z.object({ type: z.literal('lease-renew'), reqId: z.string().max(128), lease: z.string().max(4096) }).strict(),
])

/** A Cell routes only sockets admitted for one host/device and never reads application ciphertext. */
export class Cell {
  private readonly hosts = new Map<HostId, Host>()
  private readonly invites = new Map<string, { hostId: HostId; deviceId: DeviceId; expiresAt: number }>()
  private readonly tunnels = new Map<string, Tunnel>()
  private readonly usedProofs = new Map<string, number>()
  constructor(private readonly config: RelayConfig, private readonly directorKey: () => Promise<string>) {}
  /** Current control registrations for load-aware placement. */
  get hostCount(): number { return this.hosts.size }
  /** Routing identities currently occupying capacity, including registrations renewing their leases. */
  get hostIds(): string[] { return [...this.hosts.keys()] }
  /** Admit the first role-specific message within a bounded authentication lifetime. */
  accept(socket: WebSocket, path: string): void {
    const deadline = setTimeout(() => socket.close(4401, 'authentication_timeout'), this.config.handshakeMs)
    socket.once('close', () => clearTimeout(deadline))
    socket.once('message', (raw, binary) => {
      if (binary) { socket.close(4400, 'expected_json'); return }
      void this.admit(socket, path, JSON.parse.bind(JSON, raw.toString())).catch(() => socket.close(4401, 'admission_rejected')).finally(() => clearTimeout(deadline))
    })
  }
  private async admit(socket: WebSocket, path: string, parse: () => unknown): Promise<void> {
    const value = parse()
    if (path === '/v1/host/control') {
      const request = z.object({ type: z.literal('host-hello'), lease: z.string().max(4096), proof: ProofSchema }).strict().parse(value)
      const lease = verifyLease(request.lease, await this.directorKey(), this.config.regionId)
      if (!verifyProof(request.proof, 'control', this.config.handshakeMs) || request.proof.publicKey !== lease.publicKey || hostIdentity(request.proof.publicKey) !== lease.hostId) throw new Error('invalid_control_proof')
      for (const [nonce, expiry] of this.usedProofs) if (expiry < Date.now()) this.usedProofs.delete(nonce)
      if (this.usedProofs.has(request.proof.nonce)) throw new Error('replayed_control_proof')
      if (this.usedProofs.size >= this.config.maxProofs) throw new Error('proof_capacity_reached')
      this.usedProofs.set(request.proof.nonce, Date.now() + this.config.handshakeMs)
      if (socket.readyState !== WebSocket.OPEN) return
      if (!this.hosts.has(lease.hostId) && this.hosts.size >= this.config.maxHosts) throw new Error('host_capacity_reached')
      const previous = this.hosts.get(lease.hostId)
      if (previous && lease.epoch < previous.epoch) throw new Error('stale_assignment')
      previous?.control.close(4409, 'control_replaced')
      this.closeHostTunnels(lease.hostId)
      const host: Host = { control: socket, epoch: lease.epoch, expiresAt: lease.expiresAt, publicKey: lease.publicKey, devices: new Map(), queue: Promise.resolve(), queued: 0, requests: 0, rateExpiresAt: Date.now() + 60000 }
      this.hosts.set(lease.hostId, host)
      this.send(socket, { type: 'host-registered', hostId: lease.hostId })
      socket.on('message', raw => {
        if (host.rateExpiresAt <= Date.now()) { host.requests = 0; host.rateExpiresAt = Date.now() + 60000 }
        if (host.queued >= this.config.maxControlQueue || ++host.requests > this.config.maxControlMessagesPerMinute) { socket.close(4429, 'control_rate_exceeded'); return }
        host.queued++
        host.queue = host.queue.then(() => this.control(lease.hostId, host, JSON.parse.bind(JSON, raw.toString())))
          .catch(() => socket.close(4400, 'invalid_control_message'))
          .finally(() => { host.queued-- })
      })
      socket.once('close', () => {
        if (this.hosts.get(lease.hostId) !== host) return
        this.hosts.delete(lease.hostId)
        this.closeHostTunnels(lease.hostId)
        for (const [hash, invite] of this.invites) if (invite.hostId === lease.hostId) this.invites.delete(hash)
      })
      return
    }
    if (path === '/v1/host/data') {
      const request = z.object({ type: z.literal('data-attach'), connId: ConnectionIdSchema, ticket: CredentialSchema }).strict().parse(value)
      const tunnel = this.tunnels.get(request.connId)
      if (!tunnel || tunnel.data || tunnel.ticketHash !== digest(request.ticket) || tunnel.phone.readyState !== WebSocket.OPEN || socket.readyState !== WebSocket.OPEN) throw new Error('invalid_attach_ticket')
      clearTimeout(tunnel.deadline)
      tunnel.data = socket
      this.send(socket, { type: 'data-attached' })
      socket.on('message', (raw, binary) => this.forward(tunnel.phone, raw.toString(), binary))
      socket.once('close', () => this.closeTunnel(request.connId))
      this.send(tunnel.phone, { type: 'relay-ready', deviceId: tunnel.deviceId })
      return
    }
    if (path !== '/v1/connect') throw new Error('unknown_endpoint')
    const request = z.object({ type: z.literal('relay-auth'), hostId: HostIdSchema, deviceId: DeviceIdSchema.optional(), credential: CredentialSchema }).strict().parse(value)
    const host = this.hosts.get(request.hostId)
    if (!host || host.expiresAt <= Date.now() || host.control.readyState !== WebSocket.OPEN) throw new Error('host_offline')
    const hash = digest(request.credential)
    const invite = this.invites.get(hash)
    let deviceId: DeviceId
    if (invite) {
      if (invite.hostId !== request.hostId || invite.expiresAt <= Date.now()) throw new Error('invite_expired')
      deviceId = invite.deviceId
      this.invites.delete(hash)
    } else {
      if (!request.deviceId || host.devices.get(request.deviceId) !== hash) throw new Error('invalid_device_credential')
      deviceId = request.deviceId
    }
    if ([...this.tunnels.values()].filter(item => item.hostId === request.hostId).length >= this.config.maxConnectionsPerHost) throw new Error('connection_capacity_reached')
    const connId = ConnectionIdSchema.parse(randomUUID())
    const ticket = randomSecret()
    const tunnel: Tunnel = { hostId: request.hostId, deviceId, ticketHash: digest(ticket), phone: socket, deadline: setTimeout(() => this.closeTunnel(connId), this.config.handshakeMs) }
    this.tunnels.set(connId, tunnel)
    socket.on('message', (raw, binary) => {
      if (!tunnel.data) { socket.close(4400, 'data_not_attached'); return }
      this.forward(tunnel.data, raw.toString(), binary)
    })
    socket.once('close', () => this.closeTunnel(connId))
    this.send(host.control, { type: 'conn-open', connId, ticket, deviceId })
  }
  private async control(hostId: HostId, host: Host, parse: () => unknown): Promise<void> {
    if (this.hosts.get(hostId) !== host || host.expiresAt <= Date.now()) throw new Error('stale_control')
    const message = HostControlSchema.parse(parse())
    let value: unknown = { accepted: true }
    switch (message.type) {
      case 'invite-create': {
        if ([...this.invites.values()].filter(invite => invite.hostId === hostId).length >= this.config.maxConnectionsPerHost) throw new Error('invite_capacity_reached')
        const token = randomSecret()
        const expiresAt = Date.now() + this.config.inviteMs
        this.invites.set(digest(token), { hostId, deviceId: message.deviceId, expiresAt })
        value = { invite: token, expiresAt }
        break
      }
      case 'device-install': host.devices.set(message.deviceId, message.hash); break
      case 'device-revoke': {
        host.devices.delete(message.deviceId)
        for (const [hash, invite] of this.invites) if (invite.hostId === hostId && invite.deviceId === message.deviceId) this.invites.delete(hash)
        for (const [connId, tunnel] of this.tunnels) if (tunnel.hostId === hostId && tunnel.deviceId === message.deviceId) this.closeTunnel(connId)
        break
      }
      case 'lease-renew': {
        const lease = verifyLease(message.lease, await this.directorKey(), this.config.regionId)
        if (lease.hostId !== hostId || lease.publicKey !== host.publicKey || lease.epoch !== host.epoch) throw new Error('invalid_renewal')
        host.expiresAt = lease.expiresAt
        break
      }
    }
    this.send(host.control, { type: 'control-result', reqId: message.reqId, value })
  }
  /** Expire grants and control leases independently of socket liveness. */
  prune(): void {
    for (const [hash, invite] of this.invites) if (invite.expiresAt <= Date.now()) this.invites.delete(hash)
    for (const host of this.hosts.values()) if (host.expiresAt <= Date.now()) host.control.close(4401, 'lease_expired')
  }
  private forward(socket: WebSocket, value: string, binary: boolean): void {
    if (binary || Buffer.byteLength(value) > this.config.maxPayloadBytes || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount + Buffer.byteLength(value) > this.config.maxBufferedBytes) { socket.close(4400, 'invalid_or_backpressured_frame'); return }
    socket.send(value)
  }
  private send(socket: WebSocket, value: unknown): void { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)) }
  private closeTunnel(connId: string): void {
    const tunnel = this.tunnels.get(connId)
    if (!tunnel) return
    this.tunnels.delete(connId)
    clearTimeout(tunnel.deadline)
    tunnel.phone.close(4404, 'peer_offline'); tunnel.data?.close(4404, 'peer_offline')
  }
  private closeHostTunnels(hostId: HostId): void { for (const [connId, tunnel] of this.tunnels) if (tunnel.hostId === hostId) this.closeTunnel(connId) }
  /** Stop every admission and outstanding data-attach deadline. */
  dispose(): void {
    for (const connId of [...this.tunnels.keys()]) this.closeTunnel(connId)
    for (const host of this.hosts.values()) host.control.close(1001, 'shutdown')
    this.hosts.clear(); this.invites.clear(); this.usedProofs.clear()
  }
}
