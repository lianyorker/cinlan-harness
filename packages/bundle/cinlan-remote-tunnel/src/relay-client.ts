/** Host-side control lease renewal and reverse data attachments to a Cinlan Cell. */
import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'
import { z } from 'zod'
import { AssignmentSchema, HostIdSchema, DeviceIdSchema, ConnectionIdSchema, socketUrl, type Assignment, type DeviceId, type ConnectionId } from '@cinlan/mobile-relay/protocol'
import { base64, createProof, hostIdentity, nacl } from '@cinlan/mobile-relay/crypto'

const ControlMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('host-registered'), hostId: HostIdSchema }).strict(),
  z.object({ type: z.literal('control-result'), reqId: z.string(), value: z.unknown() }).strict(),
  z.object({ type: z.literal('conn-open'), connId: ConnectionIdSchema, ticket: z.string(), deviceId: DeviceIdSchema }).strict(),
])

/** One control generation; loss closes its data sockets and rejects outstanding requests. */
export class RelayClient {
  private control: WebSocket | undefined
  private assignment: Assignment | undefined
  private readonly data = new Set<WebSocket>()
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  private renewal: ReturnType<typeof setTimeout> | undefined
  private closed = false
  private registered = false
  private readonly abort = new AbortController()
  constructor(
    private readonly directorUrl: string,
    private readonly preferredRegion: string,
    private readonly secretKey: Uint8Array,
    private readonly deadlineMs: number,
    private readonly maxPayloadBytes: number,
    private readonly maxBufferedBytes: number,
    private readonly onData: (socket: WebSocket, deviceId: DeviceId) => void,
    private readonly onOffline: () => void,
    private readonly enrollmentToken?: string,
  ) {}
  /** Current Cell URL is meaningful only while the control generation is online. */
  get cellUrl(): string { if (!this.assignment) throw new Error('relay_offline'); return this.assignment.region.url }
  private async assign(): Promise<Assignment> {
    const response = await fetch(this.directorUrl + '/v1/assign', {
      method: 'POST', headers: { 'content-type': 'application/json', ...(this.enrollmentToken ? { authorization: 'Bearer ' + this.enrollmentToken } : {}) },
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(this.deadlineMs)]),
      body: JSON.stringify({ proof: createProof('assign', this.secretKey), ...(this.preferredRegion ? { preferredRegion: this.preferredRegion } : {}) }),
    })
    if (!response.ok) throw new Error('relay_assignment_failed')
    const assignment = AssignmentSchema.parse(await response.json())
    if (assignment.hostId !== hostIdentity(base64(nacl.sign.keyPair.fromSecretKey(this.secretKey).publicKey)) || assignment.expiresAt <= Date.now()) throw new Error('invalid_host_assignment')
    return assignment
  }
  /** Establish a signed control registration; application data uses independent sockets. */
  async connect(): Promise<void> {
    this.assignment = await this.assign()
    if (this.closed) throw new Error('relay_closed')
    const control = new WebSocket(socketUrl(this.cellUrl, '/v1/host/control'), { maxPayload: this.maxPayloadBytes, perMessageDeflate: false })
    this.control = control
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('relay_registration_timeout')); control.terminate() }, this.deadlineMs)
      const finish = (error?: Error): void => { clearTimeout(timer); if (error) reject(error); else resolve() }
      control.once('open', () => control.send(JSON.stringify({ type: 'host-hello', lease: this.assignment!.lease, proof: createProof('control', this.secretKey) })))
      control.on('message', raw => {
        try {
          const message = ControlMessageSchema.parse(JSON.parse(raw.toString()))
          if (message.type === 'host-registered') {
            if (this.registered || message.hostId !== this.assignment?.hostId) throw new Error('invalid_registration')
            this.registered = true; finish(); return
          }
          if (!this.registered) throw new Error('registration_required')
          if (message.type === 'control-result') {
            const pending = this.pending.get(message.reqId)
            if (pending) { clearTimeout(pending.timer); this.pending.delete(message.reqId); pending.resolve(message.value) }
          } else this.attach(message)
        } catch (_invalidControlMessage) { control.close(4400, 'invalid_control_message') }
      })
      control.once('error', () => finish(new Error('relay_connection_failed')))
      control.once('close', () => {
        finish(new Error('relay_offline'))
        const wasClosed = this.closed
        this.close()
        if (!wasClosed) this.onOffline()
      })
    })
    this.scheduleRenewal()
  }
  private scheduleRenewal(): void {
    this.renewal = setTimeout(() => {
      void (async () => {
        const next = await this.assign()
        if (this.closed) return
        if (next.region.url !== this.cellUrl || next.epoch !== this.assignment?.epoch) { this.close(); this.onOffline(); return }
        await this.request('lease-renew', { lease: next.lease })
        this.assignment = next
        this.scheduleRenewal()
      })().catch(() => { if (!this.closed) { this.close(); this.onOffline() } })
    }, Math.max(1, (this.assignment!.expiresAt - Date.now()) / 2))
  }
  /** Correlate a bounded control request without exposing device credentials. */
  request(type: string, payload: Record<string, string>): Promise<unknown> {
    if (this.closed || !this.registered || this.control?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('relay_offline'))
    if (this.pending.size >= 32 || this.control.bufferedAmount > this.maxBufferedBytes) return Promise.reject(new Error('relay_backpressure'))
    const reqId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(reqId); reject(new Error('relay_control_timeout')) }, this.deadlineMs)
      this.pending.set(reqId, { resolve, reject, timer })
      this.control!.send(JSON.stringify({ type, reqId, ...payload }), error => {
        if (!error) return
        clearTimeout(timer); this.pending.delete(reqId); reject(new Error('relay_send_failed'))
      })
    })
  }
  private attach(message: { connId: ConnectionId; ticket: string; deviceId: DeviceId }): void {
    if (this.closed) return
    const socket = new WebSocket(socketUrl(this.cellUrl, '/v1/host/data'), { maxPayload: this.maxPayloadBytes, perMessageDeflate: false })
    this.data.add(socket)
    const timer = setTimeout(() => socket.terminate(), this.deadlineMs)
    socket.once('open', () => socket.send(JSON.stringify({ type: 'data-attach', connId: message.connId, ticket: message.ticket })))
    socket.once('message', raw => {
      clearTimeout(timer)
      try {
        z.object({ type: z.literal('data-attached') }).strict().parse(JSON.parse(raw.toString()))
        this.onData(socket, message.deviceId)
      } catch (_invalidAttachment) { socket.close(4400, 'invalid_attachment') }
    })
    socket.once('error', () => socket.terminate())
    socket.once('close', () => { clearTimeout(timer); this.data.delete(socket) })
  }
  /** Cancel lease HTTP requests, deadlines, and every physical socket in this generation. */
  close(): void {
    if (this.closed) return
    this.closed = true; this.registered = false; this.abort.abort()
    if (this.renewal) clearTimeout(this.renewal)
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('relay_offline')) }
    this.pending.clear()
    for (const socket of this.data) socket.terminate()
    this.data.clear(); this.control?.terminate()
  }
}
