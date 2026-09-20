/** Same-Host HTTPS carrier; authenticates before admission and never reuses browser administrator cookies. */
import { createServer, type Server } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isIP } from 'node:net'
import type { Duplex } from 'node:stream'
import { readFile } from 'node:fs/promises'
import { X509Certificate } from 'node:crypto'
import { bridgeConnectionRequest, type HostConnectionAccess, type HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { RemoteStreamMuxServer, type TypertGateway } from '@deepseek-ai/dsh-api-gateway'
import type { ResolvedConfig } from './config.ts'
import { PairingGrants } from './grants.ts'
import { PairedSessionPolicy } from './policy.ts'
import type { PairedDeviceId, RemoteAccessHost, StoredDevice } from './types.ts'
import { pairingPage } from './pairing-page.ts'

const COOKIE = '__Host-dsh-paired'
interface AccessEntry {
  readonly access: HostConnectionAccess
  readonly abort: AbortController
  readonly timer: NodeJS.Timeout
  readonly release: () => void
  readonly record: StoredDevice
}

/** Owns one HTTPS listener and all its authenticated request and socket lifetimes. */
export class PairingListener {
  /** Advertised HTTPS origin with the actual port after listener activation. */
  origin: string
  /** SHA-256 fingerprint of the configured server certificate, absent before activation. */
  certificateFingerprint: string | null = null
  private server: Server | undefined
  private readonly sockets = new Set<Duplex>()
  private readonly accesses = new Map<PairedDeviceId, AccessEntry>()
  private readonly mux: RemoteStreamMuxServer
  private readonly active = new Set<Promise<unknown>>()
  private closed = false
  private authorizationRevision = 0

  /**
   * @param config - validated deployment settings with a trusted TLS certificate and key.
   * @param host - existing Desktop lifecycle and asset capability.
   * @param connection - same Host's Connection dispatcher.
   * @param gateway - same Host's Gateway and pending interaction owner.
   * @param grants - durable device credential owner.
   */
  constructor(
    private readonly config: ResolvedConfig, private readonly host: RemoteAccessHost,
    private readonly connection: HostConnectionHandle, private readonly gateway: TypertGateway,
    private readonly grants: PairingGrants,
  ) {
    const origin = new URL(config.advertisedOrigin)
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Pairing requires an exact HTTPS origin')
    this.origin = origin.origin
    this.mux = new RemoteStreamMuxServer(() => Promise.reject(new Error('Authenticated stream binding is required')), gateway.wireStream.failure, config.websocketHeartbeatIntervalMs, { maxPayloadBytes: config.maxRequestBodyBytes, maxStreamsPerConnection: config.maxStreamsPerConnection })
  }

  /** Start TLS after checking certificate dates and the advertised hostname. */
  async start(): Promise<void> {
    const [cert, key] = await Promise.all([readFile(this.config.tlsCertificatePath), readFile(this.config.tlsPrivateKeyPath)])
    const certificate = new X509Certificate(cert)
    const advertisedHostname = new URL(this.origin).hostname
    const hostname = advertisedHostname.startsWith('[') ? advertisedHostname.slice(1, -1) : advertisedHostname
    if ((isIP(hostname) ? certificate.checkIP(hostname) : certificate.checkHost(hostname)) === undefined) throw new Error('TLS certificate does not identify the advertised host')
    if (Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) throw new Error('TLS certificate is outside its validity period')
    this.certificateFingerprint = certificate.fingerprint256
    const server = createServer({ cert, key, minVersion: 'TLSv1.2', requestTimeout: this.config.requestTimeoutMs, headersTimeout: this.config.requestTimeoutMs }, (req, res) => {
      if (this.active.size >= this.config.maxConnections) { end(res, 503); return }
      this.track(this.http(req, res).catch(() => { if (res.headersSent) res.destroy(); else end(res, 503) }))
    })
    this.server = server
    server.maxConnections = this.config.maxConnections
    server.on('connection', (socket) => { this.sockets.add(socket); socket.once('close', () => { this.sockets.delete(socket) }) })
    server.on('upgrade', (req, socket, head) => { this.track(this.upgrade(req, socket, head).catch(() => { socket.destroy() })) })
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error): void => { reject(error) }
      server.once('error', failed)
      server.listen(this.config.port, this.config.host, () => { server.off('error', failed); resolve() })
    })
    const address = server.address()
    if (this.config.port === 0 && address !== null && typeof address !== 'string') {
      const origin = new URL(this.origin)
      origin.port = String(address.port)
      this.origin = origin.origin
    }
  }

  /**
   * Terminate a device's active requests and WebSockets after revocation commits.
   * @param deviceId - revoked credential identity.
   */
  revoke(deviceId: PairedDeviceId): void {
    this.authorizationRevision++
    const entry = this.accesses.get(deviceId)
    if (entry === undefined) return
    this.accesses.delete(deviceId)
    clearTimeout(entry.timer)
    entry.abort.abort(new Error('Paired device authorization ended'))
    entry.release()
  }

  /** Terminate sockets and settle admitted requests before releasing the listener. */
  async close(): Promise<void> {
    this.closed = true
    this.grants.cancelInvitation()
    for (const id of [...this.accesses.keys()]) this.revoke(id)
    for (const socket of this.sockets) socket.destroy()
    await this.mux.close()
    const server = this.server
    if (server !== undefined) await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    await Promise.allSettled([...this.active])
  }

  private track(operation: Promise<unknown>): void {
    this.active.add(operation)
    void operation.finally(() => { this.active.delete(operation) }).catch(() => undefined)
  }

  private trusted(req: IncomingMessage): boolean {
    if (this.closed || req.headers.host !== new URL(this.origin).host || !req.url?.startsWith('/') || req.url.startsWith('//')) return false
    const origin = req.headers.origin
    if (origin !== undefined && origin !== this.origin) return false
    if (req.headers['sec-fetch-site'] === 'cross-site') return false
    return true
  }

  private async authenticated(req: IncomingMessage): Promise<HostConnectionAccess | undefined> {
    const matches = (req.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(COOKIE + '='))
    const cookie = matches[0]
    if (matches.length !== 1 || cookie === undefined) return undefined
    const revision = this.authorizationRevision
    const record = await this.grants.authenticate(cookie.slice(COOKIE.length + 1))
    if (record === undefined || this.closed || revision !== this.authorizationRevision) return undefined
    const existing = this.accesses.get(record.deviceId)
    if (existing !== undefined) {
      if (JSON.stringify(existing.record) === JSON.stringify(record)) return existing.access
      this.revoke(record.deviceId)
    }
    const abort = new AbortController()
    const access: HostConnectionAccess = Object.freeze({ kind: 'delegated', identity: Object.freeze({}), signal: abort.signal, authorizeFetch: () => { throw new Error('Raw Fetch routes are unavailable to paired devices') } })
    const policy = new PairedSessionPolicy(record, this.config.maxQueuedEvents, this.config.maxQueuedEventBytes)
    const release = this.gateway.registerAccess(access, policy)
    const timer = setTimeout(() => { this.revoke(record.deviceId) }, Math.max(1, record.expiresAt - Date.now()))
    timer.unref()
    this.accesses.set(record.deviceId, { access, abort, release, timer, record })
    return access
  }

  private async http(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.trusted(req)) { end(res, 403); return }
    const url = new URL(req.url ?? '/', this.origin)
    if (url.pathname === '/pair/protocol' && req.method === 'GET') { json(res, { protocolVersion: 1 }); return }
    if (url.pathname === '/pair' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'", 'referrer-policy': 'no-referrer' })
      res.end(pairingPage()); return
    }
    if (url.pathname === '/pair/exchange' && req.method === 'POST') {
      if (req.headers.origin !== this.origin) { end(res, 403); return }
      await bridgeConnectionRequest(req, res, { requestBodyMode: () => 'buffered', fetch: async (request) => {
        try {
          const value: unknown = await request.json()
          const result = await this.host.dispatch(() => this.grants.exchange(value))
          return Response.json({ protocolVersion: 1, device: result.device }, { headers: { 'set-cookie': COOKIE + '=' + result.credential + '; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + String(Math.max(0, Math.floor((result.device.expiresAt - Date.now()) / 1000))), 'cache-control': 'no-store' } })
        } catch { return new Response(null, { status: 403 }) }
      } }, this.config.maxRequestBodyBytes)
      return
    }
    const access = await this.authenticated(req)
    if (access === undefined) {
      if (req.method === 'GET' && url.pathname === '/') { res.writeHead(303, { location: '/pair', 'cache-control': 'no-store' }); res.end() }
      else end(res, 401)
      return
    }
    const revokeResponse = (): void => { res.destroy() }
    access.signal.addEventListener('abort', revokeResponse, { once: true })
    res.once('close', () => { access.signal.removeEventListener('abort', revokeResponse) })
    if (access.signal.aborted) { revokeResponse(); return }
    if (url.pathname === '/pair/session' && req.method === 'GET') { json(res, { protocolVersion: 1 }); return }
    if (url.pathname.startsWith('/api/')) {
      if (req.headers.origin !== this.origin || req.headers['x-dsh-pairing-version'] !== '1') { end(res, 403); return }
      const handler = this.connection.createSharedFetchHandler('/api', access)
      await bridgeConnectionRequest(req, res, {
        requestBodyMode: () => 'buffered',
        fetch: request => this.host.dispatch(() => handler.fetch(request)),
      }, this.config.maxRequestBodyBytes)
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { end(res, 405); return }
    await bridgeConnectionRequest(req, res, { requestBodyMode: () => 'buffered', fetch: request => this.host.dispatch(() => this.host.fetchAssets(new Request(url, request))) }, this.config.maxRequestBodyBytes)
  }

  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(req.url ?? '/', this.origin)
    if (!this.trusted(req) || req.headers.origin !== this.origin || url.pathname !== '/api/remote.mux'
      || url.searchParams.get('pairingVersion') !== '1' || this.active.size >= this.config.maxConnections) {
      socket.destroy()
      return
    }
    const access = await this.authenticated(req)
    if (access === undefined) { socket.destroy(); return }
    await this.host.dispatch(() => {
      this.mux.handleUpgrade(req, socket, head, { signal: access.signal,
        open: (endpoint, payload, signal) => this.host.dispatch(() => this.gateway.wireStream.open(endpoint, payload, signal, access)),
      })
    })
  }
}

function end(res: ServerResponse, status: number): void { res.writeHead(status, { 'cache-control': 'no-store' }); res.end() }
function json(res: ServerResponse, value: unknown): void { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) }
