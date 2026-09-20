import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { request as httpsRequest } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { once } from 'node:events'
import { expect, it, onTestFinished } from 'vitest'
import WebSocket from 'ws'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import PairingController from '../../../api/pairing-controller/src/index.ts'
import RemoteAccess from '../src/index.ts'
import type { PairingInvitation, RemoteAccessStatus } from '../src/types.ts'

// A bounded transport payload probe; Session behavior is exercised by the Desktop composition browser tests.
class ResponseProbe extends TypertRemoteService {
  static inject = ['typert']
  constructor(ctx: Context) { super(ctx, 'pairingResponseProbe', { namespace: 'session' }) }
  @Remote('list')
  list(_request: object): unknown {
    void _request
    return { items: [{ sessionId: 'original-session', cwd: 'x'.repeat(16 * 1024 * 1024) }] }
  }
}

it('pairs over validated TLS through the Loader, denies foreign authority and persists revocation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pairing-'))
  const ctx = new Context()
  const sockets: WebSocket[] = []
  onTestFinished(async () => {
    for (const socket of sockets) socket.terminate()
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const certificatePath = fileURLToPath(new URL('./fixtures/localhost-cert.pem', import.meta.url))
  const keyPath = fileURLToPath(new URL('./fixtures/localhost-key.pem', import.meta.url))
  const certificate = await readFile(certificatePath)
  let locked = false
  let admitted = 0
  let lastAdmissionResult: unknown
  ctx.provide('remoteAccessHost', {
    async dispatch<T>(operation: () => T | Promise<T>) {
      if (locked) throw new Error('update admission closed')
      admitted++
      try { lastAdmissionResult = await operation(); return lastAdmissionResult as T } finally { admitted-- }
    },
    fetchAssets() { return new Response('paired shell fixture') },
  })
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const modules = new Map<string, unknown>([
    ['credentials', LocalCredentials], ['connection', Connection], ['typert', TypertRegistry], ['gateway', TypertGateway], ['remote-access', RemoteAccess], ['pairing', PairingController], ['response-probe', ResponseProbe],
  ])
  const rows = [
    { name: 'credentials', config: { path: join(root, 'credentials.yaml'), watch: false } },
    { name: 'connection' }, { name: 'typert' }, { name: 'gateway' },
    { name: 'remote-access', config: { enabled: false, host: '127.0.0.1', port: 0, advertisedOrigin: 'https://127.0.0.1:0', tlsCertificatePath: certificatePath, tlsPrivateKeyPath: keyPath } }, { name: 'pairing' }, { name: 'response-probe' },
  ]
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, rows.map(row => '- ' + JSON.stringify(row)).join(String.fromCharCode(10)) + String.fromCharCode(10))
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(name: string) { if (!modules.has(name)) throw new Error('unexpected fixture module'); return modules.get(name) } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const access = ctx.connection.trustedAccess
  const call = (method: string, args = {}) => ctx.typertGateway.invoke({ namespace: 'pairing', method, args, access })
  expect(await call('describe')).toMatchObject({ state: 'disabled', origin: null })
  await expect(ctx.remoteAccess.enable()).rejects.toThrow('authenticated local')
  const ready = await call('enable') as RemoteAccessStatus
  expect(ready.state).toBe('ready')
  expect(ready.certificateFingerprint).toMatch(/^[0-9A-F:]+$/)
  const origin = ready.origin!
  const send = (path: string, method = 'GET', value?: unknown, headers: Record<string, string> = {}) => new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; text: string }>((resolve, reject) => {
    const req = httpsRequest(origin + path, { ca: certificate, servername: 'localhost', method, headers: { origin, ...headers, ...(value === undefined ? {} : { 'content-type': 'application/json' }) } }, (res) => {
      const chunks: Buffer[] = []; res.on('data', (chunk: Buffer) => chunks.push(chunk)); res.on('end', () =>{  resolve({ status: res.statusCode!, headers: res.headers, text: Buffer.concat(chunks).toString() }) })
    }); req.on('error', reject); req.end(value === undefined ? undefined : JSON.stringify(value))
  })
  expect((await send('/pair/protocol')).text).toBe('{"protocolVersion":1}')
  expect((await send('/pair/protocol', 'GET', undefined, { host: 'attacker.invalid' })).status).toBe(403)
  const invitation = await call('createInvitation', { request: { sessionIds: ['original-session'], scopes: ['session:read'] } }) as PairingInvitation
  const exchange = { invitationId: invitation.invitationId, code: invitation.code, displayName: 'Test phone', protocolVersion: 1 }
  expect((await send('/pair/exchange', 'POST', exchange, { origin: 'https://attacker.invalid' })).status).toBe(403)
  const paired = await send('/pair/exchange', 'POST', exchange)
  expect(paired.status).toBe(200)
  const setCookie = paired.headers['set-cookie']![0]!
  expect(setCookie).toContain('Secure; HttpOnly; SameSite=Strict')
  const cookie = setCookie.split(';')[0]!
  expect((await send('/pair/exchange', 'POST', exchange)).status).toBe(403)
  expect((await send('/pair/session', 'GET', undefined, { cookie })).status).toBe(200)
  const body = { type: 'client-request', rpcId: 'phone-1', method: 'pairing/enable', payload: { args: {} } }
  const denied = await send('/api/pairing/enable', 'POST', body, { cookie, 'x-dsh-pairing-version': '1' })
  expect(JSON.parse(denied.text)).toMatchObject({ result: { ok: false } })
  expect((await send('/api/pairing/enable', 'POST', body, { cookie })).status).toBe(403)
  locked = true
  expect((await send('/api/pairing/enable', 'POST', body, { cookie, 'x-dsh-pairing-version': '1' })).status).toBe(503)
  locked = false
  const oversized = new WebSocket(origin.replace('https:', 'wss:') + '/api/remote.mux?pairingVersion=1', {
    ca: certificate, headers: { cookie, origin },
  })
  sockets.push(oversized)
  await once(oversized, 'open')
  const oversizedClosed = once(oversized, 'close')
  oversized.send(JSON.stringify({ type: 'open', streamId: 'oversized', endpoint: '$events', payload: { args: { text: 'x'.repeat(262145) } } }))
  // The mux terminates on receiver errors, so oversized frames close without a WebSocket close handshake.
  expect((await oversizedClosed)[0]).toBe(1006)
  const socket = new WebSocket(origin.replace('https:', 'wss:') + '/api/remote.mux?pairingVersion=1', { ca: certificate, headers: { cookie, origin } })
  sockets.push(socket)
  await once(socket, 'open')
  const closed = once(socket, 'close')
  const stalled = await new Promise<IncomingMessage>((resolve, reject) => {
    const req = httpsRequest(origin + '/api/session/list', {
      ca: certificate, headers: { cookie, origin, 'x-dsh-pairing-version': '1', 'content-type': 'application/json' }, method: 'POST',
    }, (response) => { response.pause(); resolve(response) })
    req.on('error', reject)
    req.end(JSON.stringify({ type: 'client-request', rpcId: 'stalled', method: 'session/list', payload: { args: { _request: {} } } }))
  })
  stalled.on('error', () => { /* Revocation deliberately destroys a paused response. */ })
  const stalledClosed = new Promise<void>((resolve) => { stalled.once('close', resolve) })
  onTestFinished(() => { stalled.destroy() })
  expect(stalled.statusCode).toBe(200)
  expect(ctx.get('pairingResponseProbe')).toBeDefined()
  const first = await new Promise<Buffer>((resolve) => {
    stalled.once('data', (chunk: Buffer) => { stalled.pause(); resolve(chunk) })
    stalled.resume()
  })
  expect(first.toString()).toContain('"ok":true')
  expect(first.toString()).toContain('original-session')
  expect(first.toString()).toContain('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
  expect(stalled.complete).toBe(false)
  expect(admitted).toBe(0)
  expect(lastAdmissionResult).toBeInstanceOf(Response)
  locked = true
  expect((await send('/api/pairing/enable', 'POST', body, { cookie, 'x-dsh-pairing-version': '1' })).status).toBe(503)
  locked = false
  const { device } = JSON.parse(paired.text) as { device: { deviceId: string } }
  await call('revokeDevice', { request: { deviceId: device.deviceId } })
  await closed
  stalled.resume()
  await stalledClosed
  expect((await send('/pair/session', 'GET', undefined, { cookie })).status).toBe(401)
  const persisted = await readFile(join(root, 'credentials.yaml'), 'utf8')
  expect(persisted).not.toContain(cookie.split('=')[1])
  expect(persisted).toContain('revokedAt')
  expect(await call('disable')).toMatchObject({ state: 'disabled', origin: null })
})
