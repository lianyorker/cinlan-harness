/** Durable device enrollment and restricted encrypted mobile application calls. */
import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { hostname, networkInterfaces, platform } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import { WebSocket, WebSocketServer } from 'ws'
import { z } from 'zod'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-workspace'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ApprovalOutcome, ApprovalRequestEvent } from '@deepseek-ai/dsh-user-approval/types'
import { AdminStateSchema, AppRequestSchema, DeviceSchema, HostSettingsSchema, RegionSchema, encodeOffer, type AppRequest, type Approval, type Desktop, type PairingOffer, type HostId, type DeviceId, type ApprovalId } from '@cinlan/mobile-relay/protocol'
import { EncryptedChannel, HelloSchema, base64, digest, hostIdentity, nacl, randomSecret, unbase64 } from '@cinlan/mobile-relay/crypto'
import { validateOrigin } from '@cinlan/mobile-relay/config'
import { writePrivateState } from '@cinlan/mobile-relay/director'
import { serveMobile } from '@cinlan/mobile-relay/static'
import { RelayClient } from './relay-client.ts'

/** Validated deployment limits for the independent mobile listener. */
export const ConfigSchema = z.object({
  port: z.number().int().min(0).max(65535).default(3081),
  stateFile: z.string().min(1).optional(),
  handshakeMs: z.number().int().positive().default(10000),
  pairingMs: z.number().int().positive().default(300000),
  maxDevices: z.number().int().positive().default(32),
  maxConnections: z.number().int().positive().default(16),
  maxPayloadBytes: z.number().int().positive().default(1048576),
  maxBufferedBytes: z.number().int().positive().default(2097152),
  maxQueuedRequests: z.number().int().positive().default(32),
  maxRequestsPerMinute: z.number().int().positive().default(120),
  heartbeatMs: z.number().int().positive().default(15000),
  reconnectMs: z.number().int().positive().default(5000),
  allowInsecureNetwork: z.boolean().default(false),
  enrollmentToken: z.string().min(32).optional(),
  mobileAssetsDir: z.string().min(1).optional(),
  mobilePublicUrl: z.string().url().optional(),
}).strict()
/** Input configuration; defaults are resolved before opening any socket. */
export type Config = z.input<typeof ConfigSchema>
const DeviceRecordSchema = DeviceSchema.extend({ tokenHash: z.string().length(86), relayHash: z.string().length(86) }).strict()
const StateSchema = z.object({ v: z.literal(1), signingKey: z.string(), boxKey: z.string(), settings: HostSettingsSchema, devices: z.array(DeviceRecordSchema) }).strict()
const AdminRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('state') }).strict(),
  z.object({ operation: z.literal('save'), settings: HostSettingsSchema }).strict(),
  z.object({ operation: z.literal('pair') }).strict(),
  z.object({ operation: z.literal('revoke'), deviceId: z.string().max(128) }).strict(),
])
interface Peer { socket: WebSocket; channel?: EncryptedChannel; deviceId?: DeviceId; relayDeviceId?: DeviceId; subscription?: AbortController; controller: AbortController; queue: Promise<void>; queued: number; requests: number; rateExpiresAt: number }
interface PendingApproval { request: Approval; resolve(outcome: ApprovalOutcome): void; abort(): void }

declare module '@deepseek-ai/cordis' { interface Context { remoteTunnel: CinlanMobileHost } }

/** Built-in Host owner; the operator API only configures this restricted mobile endpoint. */
export class CinlanMobileHost extends Service {
  static inject = ['connection', 'sessionController', 'approval', 'sessions', 'agents', 'workspaceRegistry']
  private readonly state: z.infer<typeof StateSchema>
  private readonly stateFile: string
  private readonly config: z.output<typeof ConfigSchema>
  private readonly boxKey: nacl.BoxKeyPair
  private readonly signingKey: Uint8Array
  private readonly peers = new Set<Peer>()
  private readonly tickets = new Map<string, { deviceId: DeviceId; expiresAt: number }>()
  private readonly approvals = new Map<ApprovalId, PendingApproval>()
  private server: Server | undefined
  private wss: WebSocketServer | undefined
  private listeningHost = '127.0.0.1'
  private port = 0
  private relay: RelayClient | undefined
  private relayStatus = 'offline'
  private regions: import('@cinlan/mobile-relay/protocol').Region[] = []
  private reconnect: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private operations: Promise<unknown> = Promise.resolve()
  private readonly tasks = new Set<Promise<unknown>>()

  constructor(ctx: Context, input: Config = {}) {
    super(ctx, 'remoteTunnel')
    this.config = ConfigSchema.parse(input)
    this.stateFile = this.config.stateFile ?? resolve(ctx.get('profileContext')?.dir ?? '.', 'mobile-host.json')
    try { this.state = StateSchema.parse(JSON.parse(readFileSync(this.stateFile, 'utf8'))) }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      this.state = { v: 1, signingKey: base64(nacl.sign.keyPair().secretKey), boxKey: base64(nacl.box.keyPair().secretKey), settings: { name: hostname(), mode: 'local', directorUrl: '', preferredRegion: '', address: '' }, devices: [] }
      this.saveState()
    }
    this.boxKey = nacl.box.keyPair.fromSecretKey(unbase64(this.state.boxKey, 32))
    this.signingKey = unbase64(this.state.signingKey, 64)
  }
  /** Initialize the encrypted listener and authenticated operator configuration route. */
  async [Service.init](): Promise<void> {
    await this.listen(this.state.settings.mode === 'lan' ? '0.0.0.0' : '127.0.0.1')
    this.ctx.effect(() => this.ctx.connection.fetch.register({
      path: '/api/mobile-admin', methods: ['POST'], requestBody: 'buffered',
      fetch: async request => {
        const envelope = z.object({ type: z.literal('client-request'), rpcId: z.string(), method: z.literal('mobile-admin'), payload: z.unknown() }).strict().parse(await request.json())
        let result: unknown
        try { result = { ok: true, value: await this.admin(envelope.payload) } }
        catch (error) { result = { ok: false, error: { code: 'mobile/request-rejected', message: error instanceof Error ? error.message : 'mobile_request_failed', details: {} } } }
        return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result })
      },
    }), 'mobile-host: operator settings')
    this.ctx.on('approval/request', (request, next) => this.answerApproval(request, next))
    for (const event of ['api-session/added', 'api-session/removed', 'api-session/status', 'api-session/activity'] as const) this.ctx.on(event, () => { this.track(this.publishDesktop()) })
    const alive = new Set<WebSocket>()
    const heartbeat = setInterval(() => {
      for (const peer of this.peers) {
        if (!alive.delete(peer.socket)) { peer.socket.terminate(); continue }
        peer.socket.ping()
      }
      for (const [hash, ticket] of this.tickets) if (ticket.expiresAt <= Date.now()) this.tickets.delete(hash)
    }, this.config.heartbeatMs)
    this.ctx.on('mobile-host/socket', socket => { alive.add(socket); socket.on('pong', () => alive.add(socket)); socket.once('close', () => alive.delete(socket)) })
    this.ctx.effect(() => async () => {
      this.disposed = true; clearInterval(heartbeat)
      if (this.reconnect) clearTimeout(this.reconnect)
      this.relay?.close()
      for (const approval of this.approvals.values()) approval.abort()
      for (const peer of this.peers) peer.socket.terminate()
      await this.stopListener()
      await this.operations
      await Promise.allSettled([...this.tasks])
    }, 'mobile-host: lifecycle')
    if (this.state.settings.mode === 'relay') this.track(this.connectRelay())
  }
  private track(task: Promise<unknown>): void {
    this.tasks.add(task)
    void task.catch(() => { /* State and callers report operation failures; payloads never enter logs. */ }).finally(() => this.tasks.delete(task))
  }
  private saveState(): void { writePrivateState(this.stateFile, this.state) }
  private get hostId(): HostId { return hostIdentity(base64(nacl.sign.keyPair.fromSecretKey(this.signingKey).publicKey)) }
  private async listen(host: '127.0.0.1' | '0.0.0.0'): Promise<void> {
    const server = createServer((req, res) => {
      void serveMobile(this.config.mobileAssetsDir ?? fileURLToPath(new URL('../../../../apps/mobile/dist', import.meta.url)), req, res).then(handled => { if (!handled) { res.writeHead(404); res.end() } }, () => { res.writeHead(500); res.end() })
    })
    server.requestTimeout = this.config.handshakeMs; server.headersTimeout = this.config.handshakeMs
    const wss = new WebSocketServer({ server, path: '/mobile', maxPayload: this.config.maxPayloadBytes, perMessageDeflate: false })
    wss.on('connection', socket => this.accept(socket))
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(this.config.port, host, () => { server.off('error', reject); resolve() }) })
    server.on('error', () => { for (const peer of this.peers) peer.socket.terminate() })
    this.server = server; this.wss = wss; this.listeningHost = host
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('mobile_listener_unavailable')
    this.port = address.port
  }
  private async stopListener(): Promise<void> {
    const server = this.server; const wss = this.wss
    this.server = undefined; this.wss = undefined
    if (!server || !wss) return
    for (const socket of wss.clients) socket.terminate()
    await new Promise<void>(resolve => wss.close(() => resolve()))
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() })
  }
  /** Apply only operator-authenticated settings and enrollment commands. */
  admin(value: unknown): Promise<unknown> {
    return this.serialize(() => this.executeAdmin(value))
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.operations.then(() => {
      if (this.disposed) throw new Error('mobile_host_disposed')
      return operation()
    })
    this.operations = task.catch(() => {})
    return task
  }
  private async executeAdmin(value: unknown): Promise<unknown> {
    const request = AdminRequestSchema.parse(value)
    switch (request.operation) {
      case 'state': return AdminStateSchema.parse({ hostId: this.hostId, settings: this.state.settings, addresses: this.addresses(), port: this.port, devices: this.state.devices.map(({ tokenHash: _token, relayHash: _relay, ...device }) => device), relayStatus: this.relayStatus, regions: this.regions })
      case 'save': {
        const settings = request.settings
        if (settings.directorUrl) settings.directorUrl = validateOrigin(settings.directorUrl, this.config.allowInsecureNetwork)
        if (settings.mode === 'relay' && !settings.directorUrl) throw new Error('director_url_required')
        const relayChanged = settings.directorUrl !== this.state.settings.directorUrl || settings.preferredRegion !== this.state.settings.preferredRegion || settings.mode !== this.state.settings.mode
        const previous = this.state.settings
        this.state.settings = settings
        this.tickets.clear()
        const bind = settings.mode === 'lan' ? '0.0.0.0' : '127.0.0.1'
        try {
          if (bind !== this.listeningHost) { await this.stopListener(); await this.listen(bind) }
          if (relayChanged) {
            if (this.reconnect) { clearTimeout(this.reconnect); this.reconnect = undefined }
            this.relay?.close(); this.relay = undefined; this.relayStatus = 'offline'; this.regions = []
            if (settings.mode === 'relay') await this.connectRelay()
          }
          this.saveState()
        } catch (error) {
          this.state.settings = previous
          if (this.reconnect) { clearTimeout(this.reconnect); this.reconnect = undefined }
          this.relay?.close(); this.relay = undefined; this.relayStatus = 'offline'
          await this.stopListener()
          await this.listen(previous.mode === 'lan' ? '0.0.0.0' : '127.0.0.1')
          if (previous.mode === 'relay') this.track(this.connectRelay())
          throw error
        }
        await this.publishDesktop()
        return this.executeAdmin({ operation: 'state' })
      }
      case 'pair': return this.createPairing()
      case 'revoke': {
        const previous = this.state.devices
        this.state.devices = previous.filter(device => device.id !== request.deviceId)
        try { this.saveState() } catch (error) { this.state.devices = previous; throw error }
        for (const peer of this.peers) if (peer.deviceId === request.deviceId) peer.socket.close(4403, 'device_revoked')
        if (this.relay) {
          const relay = this.relay
          try { await relay.request('device-revoke', { deviceId: request.deviceId }) }
          catch (_revocationOffline) { relay.close(); this.relay = undefined; this.relayStatus = 'offline'; this.scheduleRelayReconnect() }
        }
        return { revoked: true }
      }
    }
  }
  private addresses(): string[] { return [...new Set(Object.values(networkInterfaces()).flat().filter(item => item && !item.internal && item.family === 'IPv4').map(item => item!.address))] }
  private async createPairing(): Promise<{ pairingUrl: string; expiresAt: number }> {
    if (this.state.devices.length >= this.config.maxDevices) throw new Error('device_capacity_reached')
    this.tickets.clear()
    const ticket = randomSecret(); const deviceId = brandString<DeviceId>(randomUUID()); let expiresAt = Date.now() + this.config.pairingMs
    const offer: PairingOffer = { v: 1, hostId: this.hostId, name: this.state.settings.name, publicKey: base64(this.boxKey.publicKey), ticket, expiresAt }
    const settings = this.state.settings
    if (settings.mode !== 'relay') {
      const address = settings.mode === 'local' ? '127.0.0.1' : settings.address || this.addresses()[0]
      if (!address || !this.addresses().includes(address) && settings.mode === 'lan') throw new Error('select_local_network_address')
      offer.directUrl = 'ws://' + address + ':' + this.port + '/mobile'
    } else {
      if (!this.relay || this.relayStatus !== 'online') throw new Error('relay_offline')
      const invite = z.object({ invite: z.string(), expiresAt: z.number() }).strict().parse(await this.relay.request('invite-create', { deviceId }))
      expiresAt = Math.min(expiresAt, invite.expiresAt); offer.expiresAt = expiresAt
      offer.relay = { directorUrl: settings.directorUrl, cellUrl: this.relay.cellUrl, invite: invite.invite }
    }
    this.tickets.set(digest(ticket), { deviceId, expiresAt })
    const mobileUrl = this.config.mobilePublicUrl ?? (offer.directUrl ? offer.directUrl.replace(/^ws:/, 'http:').replace(/\/mobile$/, '/') : settings.directorUrl + '/')
    return { pairingUrl: encodeOffer(offer, mobileUrl), expiresAt }
  }
  private async connectRelay(): Promise<void> {
    if (this.disposed || this.state.settings.mode !== 'relay' || !this.state.settings.directorUrl) return
    const settings = this.state.settings
    this.relayStatus = 'connecting'
    const relay = new RelayClient(settings.directorUrl, settings.preferredRegion, this.signingKey, this.config.handshakeMs, this.config.maxPayloadBytes, this.config.maxBufferedBytes, (socket, deviceId) => this.accept(socket, deviceId), () => {
      if (this.relay !== relay || this.disposed) return
      this.relayStatus = 'offline'; this.relay = undefined
      this.scheduleRelayReconnect()
    }, this.config.enrollmentToken)
    this.relay = relay
    try {
      await relay.connect()
      if (this.disposed || this.relay !== relay) { relay.close(); return }
      for (const device of this.state.devices) await relay.request('device-install', { deviceId: device.id, hash: device.relayHash })
      const response = await fetch(settings.directorUrl + '/v1/regions', { signal: AbortSignal.timeout(this.config.handshakeMs) })
      if (!response.ok) throw new Error('regions_unavailable')
      const regions = z.object({ regions: z.array(RegionSchema) }).strict().parse(await response.json()).regions
      if (this.disposed || this.relay !== relay) { relay.close(); return }
      this.regions = regions
      this.relayStatus = 'online'
    } catch (error) {
      relay.close()
      if (this.relay === relay) {
        this.relay = undefined; this.relayStatus = 'offline'
        this.scheduleRelayReconnect()
      }
      throw error
    }
  }
  private scheduleRelayReconnect(): void {
    if (this.disposed || this.reconnect || this.state.settings.mode !== 'relay') return
    this.reconnect = setTimeout(() => { this.reconnect = undefined; this.track(this.connectRelay()) }, this.config.reconnectMs)
  }
  private accept(socket: WebSocket, relayDeviceId?: DeviceId): void {
    if (this.disposed || this.peers.size >= this.config.maxConnections) { socket.close(4429, 'connection_capacity_reached'); return }
    const peer: Peer = { socket, controller: new AbortController(), queue: Promise.resolve(), queued: 0, requests: 0, rateExpiresAt: Date.now() + 60000, ...(relayDeviceId ? { relayDeviceId } : {}) }
    this.peers.add(peer); this.ctx.emit('mobile-host/socket', socket)
    const deadline = setTimeout(() => { if (!peer.deviceId) socket.close(4401, 'authentication_timeout') }, this.config.handshakeMs)
    socket.on('message', (raw, binary) => {
      if (binary || socket.bufferedAmount > this.config.maxBufferedBytes) { socket.close(4400, 'invalid_frame'); return }
      if (peer.rateExpiresAt <= Date.now()) { peer.requests = 0; peer.rateExpiresAt = Date.now() + 60000 }
      if (peer.queued >= this.config.maxQueuedRequests || ++peer.requests > this.config.maxRequestsPerMinute) { socket.close(4429, 'request_rate_exceeded'); return }
      peer.queued++
      peer.queue = peer.queue.then(async () => {
        peer.controller.signal.throwIfAborted()
        if (!peer.channel) {
          const hello = HelloSchema.parse(JSON.parse(raw.toString()))
          if (hello.context.hostId !== this.hostId || hello.context.transport !== (peer.relayDeviceId ? 'relay' : 'direct')) throw new Error('handshake_context_mismatch')
          const nonce = base64(nacl.randomBytes(32))
          peer.channel = new EncryptedChannel(this.boxKey.secretKey, hello.publicKey, hello.nonce, nonce, 'host', hello.context)
          socket.send(JSON.stringify({ type: 'e2ee_ready', v: 1, publicKey: base64(this.boxKey.publicKey), nonce, clientNonce: hello.nonce, context: hello.context }))
          return
        }
        const request = AppRequestSchema.parse(peer.channel.decode(raw.toString()))
        try {
          const value = await this.serialize(() => this.invoke(peer, request))
          this.send(peer, { type: 'response', id: request.id, ok: true, value })
          if (peer.deviceId) clearTimeout(deadline)
        } catch (error) {
          this.send(peer, { type: 'response', id: request.id, ok: false, error: error instanceof Error ? error.message : 'request_rejected' })
          if (!peer.deviceId) socket.close(4401, 'authentication_rejected')
        }
      }).catch(() => socket.close(4400, 'invalid_message')).finally(() => { peer.queued-- })
    })
    socket.on('error', () => socket.terminate())
    socket.once('close', () => {
      clearTimeout(deadline); peer.controller.abort(); peer.subscription?.abort(); this.peers.delete(peer)
      this.track(peer.queue)
      if (![...this.peers].some(item => item.deviceId)) for (const approval of this.approvals.values()) approval.abort()
    })
  }
  private send(peer: Peer, payload: unknown): void {
    if (peer.socket.readyState !== WebSocket.OPEN || !peer.channel) return
    if (peer.socket.bufferedAmount > this.config.maxBufferedBytes) { peer.socket.close(4429, 'backpressure'); return }
    try { peer.socket.send(peer.channel.encode(payload), error => { if (error) peer.socket.terminate() }) }
    catch (_invalidOrOversizedResponse) { peer.socket.close(4400, 'response_unavailable') }
  }
  private async invoke(peer: Peer, request: AppRequest): Promise<unknown> {
    peer.controller.signal.throwIfAborted()
    if (request.method === 'auth') {
      if (peer.deviceId) throw new Error('already_authenticated')
      const params = request.params
      if (params.ticket) {
        const hash = digest(params.ticket); const ticket = this.tickets.get(hash)
        if (!ticket || ticket.expiresAt <= Date.now() || peer.relayDeviceId && peer.relayDeviceId !== ticket.deviceId) throw new Error('pairing_ticket_invalid')
        if (this.state.devices.length >= this.config.maxDevices) throw new Error('device_capacity_reached')
        this.tickets.delete(hash)
        const token = randomSecret(); const relayToken = randomSecret(); const now = Date.now()
        const relay = peer.relayDeviceId ? this.relay : undefined
        let installed = false
        try {
          if (peer.relayDeviceId) {
            if (!relay || this.relayStatus !== 'online') throw new Error('relay_offline')
            await relay.request('device-install', { deviceId: ticket.deviceId, hash: digest(relayToken) })
            installed = true
          }
          const desktop = await this.desktop(peer.controller.signal)
          peer.controller.signal.throwIfAborted()
          if (relay && this.relay !== relay) throw new Error('relay_generation_changed')
          const previous = this.state.devices
          this.state.devices = [...previous, { id: ticket.deviceId, name: params.name, tokenHash: digest(token), relayHash: digest(relayToken), createdAt: now, lastSeenAt: now }]
          try { this.saveState() } catch (error) { this.state.devices = previous; throw error }
          peer.deviceId = ticket.deviceId
          return { deviceId: ticket.deviceId, token, relayToken, desktop }
        } catch (error) {
          if (installed && relay) {
            try { await relay.request('device-revoke', { deviceId: ticket.deviceId }) }
            catch (_rollbackOffline) { relay.close() }
          }
          throw error
        }
      }
      const device = this.state.devices.find(item => item.id === params.deviceId && item.tokenHash === digest(params.token ?? ''))
      if (!device || peer.relayDeviceId && peer.relayDeviceId !== device.id) throw new Error('device_credential_invalid')
      const desktop = await this.desktop(peer.controller.signal)
      peer.controller.signal.throwIfAborted()
      device.lastSeenAt = Date.now(); this.saveState(); peer.deviceId = device.id
      return { deviceId: device.id, desktop }
    }
    if (!peer.deviceId || !this.state.devices.some(device => device.id === peer.deviceId)) throw new Error('authentication_required')
    switch (request.method) {
      case 'desktop': return this.desktop(peer.controller.signal)
      case 'subscribe': {
        peer.subscription?.abort()
        const controller = new AbortController(); peer.subscription = controller
        const sessionId = SessionId(request.params.sessionId)
        const known = (await this.ctx.sessionController.list({}, peer.controller.signal)).items.some(item => item.sessionId === sessionId)
        if (!known) throw new Error('session_not_available')
        for (const approval of this.approvals.values()) if (approval.request.sessionId === sessionId) this.send(peer, { type: 'event', event: 'approval', sessionId, value: approval.request })
        this.track((async () => {
          const signal = AbortSignal.any([controller.signal, peer.controller.signal])
          try {
            for await (const frame of this.ctx.sessionController.follow({ address: { kind: 'session', sessionId }, assistantStream: true, maxMessages: 50 }, signal)) {
              if (!signal.aborted) this.send(peer, { type: 'event', event: 'session', sessionId, value: frame })
            }
          } catch (_followFailed) { if (!signal.aborted) peer.socket.close(4404, 'subscription_unavailable') }
        })())
        return { subscribed: true }
      }
      case 'prompt': {
        const sessionId = SessionId(request.params.sessionId)
        if (!(await this.ctx.sessionController.list({}, peer.controller.signal)).items.some(item => item.sessionId === sessionId)) throw new Error('session_not_available')
        return this.ctx.sessionController.prompt({ sessionId, requestId: brandString<SessionRequestId>(request.params.requestId), mode: request.params.mode, content: [{ type: 'text', text: request.params.text }] }, peer.controller.signal)
      }
      case 'create': {
        const workspace = request.params.workspaceId ? this.ctx.workspaceRegistry.list().find(item => item.id === request.params.workspaceId) : undefined
        if (request.params.workspaceId && !workspace) throw new Error('workspace_not_available')
        const result = await this.ctx.sessionController.create({ ...(workspace ? { workspaceId: workspace.id } : {}) })
        let titleError: string | undefined
        if (request.params.title) {
          try { await this.ctx.sessionController.rename({ sessionId: result.sessionId, title: request.params.title }) }
          catch (_renameFailedAfterCreation) { titleError = 'session_created_title_failed' }
        }
        this.track(this.publishDesktop())
        return { ...result, ...(titleError ? { titleError } : {}) }
      }
      case 'approval': {
        const pending = this.approvals.get(request.params.approvalId)
        if (!pending || pending.request.sessionId !== request.params.sessionId) throw new Error('approval_not_pending')
        pending.resolve(request.params.decision)
        return { accepted: true }
      }
    }
  }
  private async desktop(signal: AbortSignal): Promise<Desktop> {
    const list = await this.ctx.sessionController.list({}, signal)
    return { hostId: this.hostId, name: this.state.settings.name, os: platform(), sessions: list.items.map(item => {
      const title = item.projections?.values.title
      return { id: item.sessionId, title: typeof title === 'string' ? title : basename(item.cwd ?? '') || item.sessionId, cwd: item.cwd ?? '', running: item.running, updatedAt: item.updatedAt }
    }), workspaces: this.ctx.workspaceRegistry.list().map(item => ({ id: item.id, name: basename(item.path), path: item.path, sessionIds: [...item.sessionIds] })) }
  }
  private async publishDesktop(): Promise<void> {
    if (this.disposed || ![...this.peers].some(peer => peer.deviceId)) return
    const desktop = await this.desktop(new AbortController().signal)
    for (const peer of this.peers) if (peer.deviceId) this.send(peer, { type: 'event', event: 'desktop', value: desktop })
  }
  private answerApproval(request: ApprovalRequestEvent, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> {
    const peers = [...this.peers].filter(peer => peer.deviceId && peer.socket.readyState === WebSocket.OPEN)
    if (!peers.length) return next()
    if (request.signal?.aborted) return Promise.resolve('cancelled')
    const approvalId = brandString<ApprovalId>(randomUUID())
    const approval: Approval = { approvalId, sessionId: request.agent.id, toolName: request.toolName, reason: request.reason ?? '', createdAt: Date.now(), ...(request.callId ? { callId: request.callId } : {}) }
    return new Promise(resolve => {
      const finish = (outcome: ApprovalOutcome): void => {
        if (!this.approvals.delete(approvalId)) return
        request.signal?.removeEventListener('abort', abort)
        for (const peer of this.peers) if (peer.deviceId) this.send(peer, { type: 'event', event: 'approval-settled', sessionId: request.agent.id, value: { approvalId } })
        resolve(outcome)
      }
      const abort = (): void => finish('cancelled')
      this.approvals.set(approvalId, { request: approval, resolve: finish, abort: () => finish('unavailable') })
      request.signal?.addEventListener('abort', abort, { once: true })
      for (const peer of peers) this.send(peer, { type: 'event', event: 'approval', sessionId: request.agent.id, value: approval })
    })
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** @mode emit @param socket - Newly admitted, unauthenticated mobile transport. */
    'mobile-host/socket'(socket: WebSocket): void
  }
}

