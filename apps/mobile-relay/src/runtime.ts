/** Role-specific HTTP/WS server, without a standalone application entry point. */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { z } from 'zod'
import { RelayConfigSchema, validateOrigin, type RelayConfig } from './config.ts'
import { Director } from './director.ts'
import { Cell } from './cell.ts'
import { RegionSchema } from './mobile-protocol.ts'
import { serveMobile } from './static.ts'

/** Start one node; callers own and await close(). */
export async function startRelay(input: z.input<typeof RelayConfigSchema>): Promise<{ url: string; close(): Promise<void> }> {
  const config: RelayConfig = RelayConfigSchema.parse(input)
  validateOrigin(config.publicUrl, config.allowInsecureNetwork)
  for (const region of config.regions) validateOrigin(region.url, config.allowInsecureNetwork)
  if (config.directorUrl) validateOrigin(config.directorUrl, config.allowInsecureNetwork)
  if (config.role === 'cell' && !config.directorUrl) throw new Error('cell_requires_director_url')
  const regions = config.regions.length ? config.regions : [RegionSchema.parse({ id: config.regionId, name: 'Local', url: config.publicUrl, capacity: config.maxHosts })]
  const director = config.role === 'cell' ? undefined : new Director(config, regions)
  let key: string | undefined
  const cell = config.role === 'director' ? undefined : new Cell(config, async () => {
    if (director) return director.publicKey
    if (key) return key
    const response = await fetch(config.directorUrl + '/v1/director-key', { signal: AbortSignal.timeout(config.handshakeMs) })
    if (!response.ok) throw new Error('director_key_unavailable')
    key = z.object({ publicKey: z.string().length(44) }).strict().parse(await response.json()).publicKey
    return key
  })
  const admissions = new Map<string, { count: number; expiresAt: number }>()
  const admit = (ip: string): boolean => {
    const entry = admissions.get(ip)
    if (!entry || entry.expiresAt <= Date.now()) {
      if (admissions.size >= config.maxHosts * config.maxConnectionsPerHost) return false
      admissions.set(ip, { count: 1, expiresAt: Date.now() + 60000 }); return true
    }
    return ++entry.count <= config.maxAdmissionsPerMinute
  }
  const server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://relay').pathname
      if (config.role !== 'cell' && await serveMobile(config.mobileAssetsDir ?? fileURLToPath(new URL('../../mobile/dist', import.meta.url)), req, res)) return
      res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store')
      res.setHeader('access-control-allow-origin', '*')
      if (path === '/health' && req.method === 'GET') { res.end(JSON.stringify({ status: 'ok', role: config.role, regionId: config.regionId, hosts: cell?.hostCount ?? 0, hostIds: cell?.hostIds ?? [] })); return }
      if (!director) { res.writeHead(404); res.end('{}'); return }
      if (path === '/v1/director-key' && req.method === 'GET') { res.end(JSON.stringify({ publicKey: director.publicKey })); return }
      if (path === '/v1/regions' && req.method === 'GET') { res.end(JSON.stringify({ regions })); return }
      if (path.startsWith('/v1/resolve/') && req.method === 'GET') { res.end(JSON.stringify(director.resolve(decodeURIComponent(path.slice(12))))); return }
      if (path !== '/v1/assign' || req.method !== 'POST') { res.writeHead(404); res.end('{}'); return }
      if (!admit(req.socket.remoteAddress ?? 'unknown')) { res.writeHead(429); res.end('{}'); return }
      if (config.enrollmentToken) {
        const actual = Buffer.from(req.headers.authorization ?? '')
        const expected = Buffer.from('Bearer ' + config.enrollmentToken)
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { res.writeHead(401); res.end('{}'); return }
      }
      const chunks: Buffer[] = []; let size = 0
      for await (const chunk of req) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += bytes.length
        if (size > 8192) { res.writeHead(413); res.end('{}'); return }
        chunks.push(bytes)
      }
      res.end(JSON.stringify(await director.assign(JSON.parse(Buffer.concat(chunks).toString()))))
    })().catch(() => { if (!res.headersSent) res.writeHead(400); res.end(JSON.stringify({ error: 'request_rejected' })) })
  })
  server.requestTimeout = config.handshakeMs
  server.headersTimeout = config.handshakeMs
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxPayloadBytes, perMessageDeflate: false })
  const alive = new Set<import('ws').WebSocket>()
  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://relay').pathname
    if (!cell || !['/v1/host/control', '/v1/host/data', '/v1/connect'].includes(path) || !admit(req.socket.remoteAddress ?? 'unknown')) { socket.destroy(); return }
    wss.handleUpgrade(req, socket, head, ws => {
      alive.add(ws)
      ws.on('pong', () => alive.add(ws))
      ws.on('error', () => ws.terminate())
      ws.once('close', () => alive.delete(ws))
      cell.accept(ws, path)
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, config.host, () => { server.off('error', reject); resolve() })
  })
  const port = (server.address() as AddressInfo).port
  if (config.role === 'combined' && config.port === 0 && config.regions.length === 0) regions[0]!.url = 'http://127.0.0.1:' + port
  server.on('error', () => { for (const ws of wss.clients) ws.terminate() })
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.delete(ws)) ws.terminate()
      else ws.ping()
    }
    for (const [ip, entry] of admissions) if (entry.expiresAt <= Date.now()) admissions.delete(ip)
    cell?.prune()
  }, config.heartbeatMs)
  let closing: Promise<void> | undefined
  return {
    url: 'http://' + (config.host === '0.0.0.0' ? '127.0.0.1' : config.host) + ':' + port,
    close() {
      return closing ??= (async () => {
        clearInterval(timer); cell?.dispose()
        for (const ws of wss.clients) ws.terminate()
        await new Promise<void>(resolve => wss.close(() => resolve()))
        await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() })
      })()
    },
  }
}
