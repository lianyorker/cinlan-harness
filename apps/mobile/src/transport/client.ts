/** Independent encrypted transports and saved credentials for each desktop. */
import { z } from 'zod'
import { AuthResultSchema, HostIdSchema, DeviceIdSchema, DesktopSchema, EventSchema, ResponseSchema, decodeOffer, socketUrl, type AppCommand, type Desktop, type PairingOffer } from '@cinlan/mobile-relay/protocol'
import { EncryptedChannel, ReadySchema, base64, nacl } from '@cinlan/mobile-relay/crypto'

const credential = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
export const SavedHostSchema = z.object({ hostId: HostIdSchema, name: z.string().max(128), publicKey: z.string().length(44), deviceId: DeviceIdSchema, token: credential, relayToken: credential, directUrl: z.string().url().optional(), relay: z.object({ directorUrl: z.string().url(), cellUrl: z.string().url() }).strict().optional() }).strict().refine(host => !!host.directUrl !== !!host.relay, 'exactly_one_transport_required')
export type SavedHost = z.infer<typeof SavedHostSchema>
export type MobileEvent = z.infer<typeof EventSchema>
export type HostStatus = 'connecting' | 'reconnecting' | 'paired' | 'disconnected' | 'error'

/** A saved desktop; pairing credentials are never shared with another host or a relay. */
export class MobileClient {
  private socket: WebSocket | undefined
  private channel: EncryptedChannel | undefined
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(reason: Error): void; timer: ReturnType<typeof setTimeout> }>()
  private closed = false
  private reconnect: ReturnType<typeof setTimeout> | undefined
  private attempt = 0
  private generation = 0
  private authenticated = false
  private everAuthenticated = false
  private lookup: AbortController | undefined
  saved: SavedHost | undefined
  constructor(
    private readonly source: SavedHost | PairingOffer,
    private readonly onStatus: (status: HostStatus) => void,
    private readonly onEvent: (event: MobileEvent) => void,
    private readonly onEnrolled: (host: SavedHost, desktop: Desktop) => void,
  ) { if ('deviceId' in source) this.saved = source }
  /** Dial this desktop only; a failed host does not dispose any other connection. */
  async connect(): Promise<void> {
    if (this.closed) throw new Error('connection_closed')
    const generation = ++this.generation
    this.lookup?.abort()
    const lookup = new AbortController()
    this.lookup = lookup
    if (this.reconnect) { clearTimeout(this.reconnect); this.reconnect = undefined }
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('connection_superseded')) }
    this.pending.clear(); this.authenticated = false; this.channel = undefined
    this.socket?.close()
    const source = this.saved ?? this.source
    this.onStatus('connecting')
    let endpoint = source.directUrl
    try { if (source.relay) {
      let cellUrl = source.relay.cellUrl
      if (this.saved) {
        const response = await fetch(source.relay.directorUrl + '/v1/resolve/' + encodeURIComponent(source.hostId), { signal: AbortSignal.any([lookup.signal, AbortSignal.timeout(10000)]) })
        if (!response.ok) throw new Error('desktop_unavailable')
        cellUrl = z.object({ region: z.object({ url: z.string() }).passthrough(), epoch: z.number() }).strict().parse(await response.json()).region.url
      }
      endpoint = socketUrl(cellUrl, '/v1/connect')
    } } catch (reason) {
      if (!this.closed && generation === this.generation) {
        if (this.saved) this.scheduleReconnect()
        else this.onStatus('disconnected')
      }
      throw reason
    }
    if (this.closed || generation !== this.generation) throw new Error('connection_superseded')
    if (!endpoint) throw new Error('desktop_endpoint_missing')
    const socket = new WebSocket(endpoint)
    this.socket = socket; this.authenticated = false; this.channel = undefined
    const keys = nacl.box.keyPair()
    const nonce = base64(nacl.randomBytes(32))
    const context = { hostId: source.hostId, transport: source.relay ? 'relay' as const : 'direct' as const }
    const startEncryption = (): void => socket.send(JSON.stringify({ type: 'e2ee_hello', v: 1, publicKey: base64(keys.publicKey), nonce, context }))
    let relayReady = !source.relay
    await new Promise<void>((resolve, reject) => {
      const current = (): boolean => !this.closed && generation === this.generation && this.socket === socket
      const timer = setTimeout(() => { reject(new Error('connection_timeout')); socket.close() }, 15000)
      socket.onopen = () => {
        if (!current()) { socket.close(); return }
        if (source.relay) {
          socket.send(JSON.stringify({ type: 'relay-auth', hostId: source.hostId, ...(this.saved ? { deviceId: this.saved.deviceId, credential: this.saved.relayToken } : { credential: 'invite' in source.relay ? source.relay.invite : '' }) }))
        } else startEncryption()
      }
      socket.onmessage = (event) => {
        if (!current()) return
        try {
          if (typeof event.data !== 'string') throw new Error('expected_text_frame')
          if (!relayReady) {
            z.object({ type: z.literal('relay-ready'), deviceId: z.string() }).strict().parse(JSON.parse(event.data))
            relayReady = true; startEncryption(); return
          }
          if (!this.channel) {
            const ready = ReadySchema.parse(JSON.parse(event.data))
            if (ready.publicKey !== source.publicKey) throw new Error('desktop_identity_changed')
            if (ready.clientNonce !== nonce || ready.context.hostId !== context.hostId || ready.context.transport !== context.transport) throw new Error('handshake_context_mismatch')
            this.channel = new EncryptedChannel(keys.secretKey, ready.publicKey, nonce, ready.nonce, 'phone', context)
            const name = navigator.userAgent.includes('Android') ? 'Android' : navigator.userAgent.includes('iPhone') ? 'iPhone' : 'Cinlan Mobile'
            void this.request({ method: 'auth', params: { name, ...(this.saved ? { deviceId: this.saved.deviceId, token: this.saved.token } : { ticket: 'ticket' in source ? source.ticket : '' }) } }).then((value) => {
              if (this.closed || generation !== this.generation) throw new Error('connection_superseded')
              const result = AuthResultSchema.parse(value)
              if (result.desktop.hostId !== source.hostId || this.saved && result.deviceId !== this.saved.deviceId) throw new Error('desktop_identity_mismatch')
              if (!this.saved) {
                if (!result.token || !result.relayToken) throw new Error('device_credential_missing')
                this.saved = { hostId: source.hostId, name: result.desktop.name, publicKey: source.publicKey, deviceId: result.deviceId, token: result.token, relayToken: result.relayToken, ...(source.directUrl ? { directUrl: source.directUrl } : {}), ...(source.relay ? { relay: { directorUrl: source.relay.directorUrl, cellUrl: source.relay.cellUrl } } : {}) }
              }
              this.authenticated = true; this.everAuthenticated = true; this.attempt = 0
              this.onEnrolled(this.saved, result.desktop); this.onStatus('paired')
              clearTimeout(timer); resolve()
            }).catch((reason) => { clearTimeout(timer); if (current()) this.onStatus('error'); reject(reason); socket.close() })
            return
          }
          const payload = this.channel.decode(event.data)
          const response = ResponseSchema.safeParse(payload)
          if (response.success) {
            const pending = this.pending.get(response.data.id)
            if (pending) { clearTimeout(pending.timer); this.pending.delete(response.data.id); if (response.data.ok) pending.resolve(response.data.value); else pending.reject(new Error(response.data.error ?? 'request_rejected')) }
          } else this.onEvent(EventSchema.parse(payload))
        } catch (invalidHostMessage) { clearTimeout(timer); reject(invalidHostMessage); socket.close(4400, 'invalid_host_message') }
      }
      socket.onerror = () => { clearTimeout(timer); reject(new Error('desktop_unreachable')); socket.close() }
      socket.onclose = (event) => {
        clearTimeout(timer)
        if (!current()) { reject(new Error('connection_superseded')); return }
        this.socket = undefined; this.channel = undefined; this.authenticated = false
        for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('desktop_disconnected')) }
        this.pending.clear()
        if (!this.closed) {
          if (event.code === 4403 || event.code === 4401) this.onStatus('error')
          else if (this.saved) this.scheduleReconnect()
          else this.onStatus('disconnected')
        }
        reject(new Error('desktop_disconnected'))
      }
    })
  }
  private scheduleReconnect(): void {
    if (this.closed || this.reconnect) return
    this.onStatus(this.everAuthenticated ? 'reconnecting' : 'connecting')
    this.reconnect = setTimeout(() => {
      this.reconnect = undefined
      void this.connect().catch(() => { this.onStatus('disconnected'); this.scheduleReconnect() })
    }, Math.min(30000, 1000 * 2 ** Math.min(this.attempt++, 5)) + Math.random() * 500)
  }
  /** Send an acknowledged application command to this authenticated desktop. */
  request(request: Omit<AppCommand, 'id'>): Promise<unknown> {
    if (!this.channel || this.socket?.readyState !== WebSocket.OPEN || request.method !== 'auth' && !this.authenticated) return Promise.reject(new Error('desktop_not_connected'))
    if (this.pending.size >= 32 || this.socket.bufferedAmount > 2 * 1024 * 1024) return Promise.reject(new Error('desktop_backpressure'))
    const id = base64(nacl.randomBytes(16)).replace(/\+/g, '-').replace(/\//g, '_')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('request_timeout')) }, 30000)
      this.pending.set(id, { resolve, reject, timer })
      try { this.socket!.send(this.channel!.encode({ id, ...request })) }
      catch (reason) { clearTimeout(timer); this.pending.delete(id); reject(reason) }
    })
  }
  /** Disconnect this desktop without invalidating another desktop's device credentials. */
  close(): void {
    this.closed = true; this.generation++
    this.lookup?.abort()
    if (this.reconnect) clearTimeout(this.reconnect)
    this.socket?.close()
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('connection_closed')) }
    this.pending.clear()
    this.socket = undefined; this.channel = undefined; this.authenticated = false
  }
}

/** Read bounded persisted desktop records; malformed storage is not silently treated as a connection. */
export function loadHosts(): SavedHost[] {
  const raw = localStorage.getItem('cinlan-mobile:hosts-v1')
  if (!raw) return []
  let value: unknown
  try { value = JSON.parse(raw) }
  catch (_invalidStoredJson) {
    localStorage.removeItem('cinlan-mobile:hosts-v1')
    return []
  }
  let hosts: SavedHost[]
  try { hosts = z.array(SavedHostSchema).max(32).parse(value) }
  catch (_invalidStoredHosts) {
    localStorage.removeItem('cinlan-mobile:hosts-v1')
    return []
  }
  if (new Set(hosts.map(host => host.hostId)).size !== hosts.length) throw new Error('duplicate_desktop_records')
  return hosts
}
/** Persist independent host credentials only after encrypted Host enrollment succeeds. */
export function saveHosts(hosts: SavedHost[]): void { localStorage.setItem('cinlan-mobile:hosts-v1', JSON.stringify(hosts)) }
export { decodeOffer, DesktopSchema }
