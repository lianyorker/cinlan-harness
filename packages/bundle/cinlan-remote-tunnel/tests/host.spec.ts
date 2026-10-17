/** Real encrypted sockets around the Host; controller doubles isolate transport ownership. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { AdminStateSchema, ApprovalSchema, decodeOffer, type Approval, type PairingOffer } from '@cinlan/mobile-relay/protocol'
import { MobileClient, type MobileEvent, type SavedHost } from '../../../../apps/mobile/src/transport/client.ts'
import { CinlanMobileHost } from '../src/host.ts'
import type { Config } from '../src/host.ts'
import { RelayClient } from '../src/relay-client.ts'
import { startRelay } from '../../../../apps/mobile-relay/src/runtime.ts'
import { base64, nacl } from '@cinlan/mobile-relay/crypto'

const roots: { ctx: Context; path: string }[] = []
const phones: MobileClient[] = []
const relays: Awaited<ReturnType<typeof startRelay>>[] = []
afterEach(async () => {
  for (const phone of phones.splice(0)) phone.close()
  for (const root of roots.splice(0)) { await root.ctx.fiber.dispose(); await rm(root.path, { recursive: true, force: true }) }
  for (const relay of relays.splice(0)) await relay.close()
  vi.restoreAllMocks()
})
async function boot(pairingMs = 5000, config: Config = {}) {
  const path = await mkdtemp(join(tmpdir(), 'cinlan-host-test-'))
  const ctx = new Context(); roots.push({ ctx, path })
  const prompts = vi.fn(async () => ({ accepted: true }))
  const sessionId = SessionId('session-a')
  ctx.provide('connection', { fetch: { register: () => () => {} } })
  ctx.provide('approval', {})
  ctx.provide('sessions', {})
  ctx.provide('agents', {})
  ctx.provide('workspaceRegistry', { list: () => [{ id: 'workspace-a', path, sessionIds: [sessionId] }] })
  ctx.provide('sessionController', {
    list: async () => ({ items: [{ sessionId, updatedAt: 1, running: false, cwd: path }] }),
    prompt: prompts,
    create: async () => ({ sessionId }), rename: async () => ({ title: 'created', seq: 1 }),
    async *follow(_request: object, signal: AbortSignal) {
      yield { type: 'snapshot', records: [{ type: 'event', event: { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: 'logged prompt' }] } } }] }
      if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    },
  })
  await ctx.plugin(CinlanMobileHost, { port: 0, stateFile: join(path, 'host.json'), pairingMs, ...config })
  const host = ctx.remoteTunnel
  const offer = async () => decodeOffer(z.object({ pairingUrl: z.string(), expiresAt: z.number() }).parse(await host.admin({ operation: 'pair' })).pairingUrl)
  return { ctx, host, offer, prompts, path, sessionId }
}
async function phone(source: PairingOffer | SavedHost) {
  const events: MobileEvent[] = []; let saved: SavedHost | undefined
  const client = new MobileClient(source, () => {}, event => events.push(event), record => { saved = record })
  phones.push(client); await client.connect()
  return { client, events, get saved() { if (!saved) throw new Error('not_enrolled'); return saved } }
}
it('keeps two desktops independent, follows logged messages and rejects unavailable sessions', async () => {
  const a = await boot(); const b = await boot()
  const first = await phone(await a.offer()); const second = await phone(await b.offer())
  expect(first.saved.hostId).not.toBe(second.saved.hostId)
  await first.client.request({ method: 'subscribe', params: { sessionId: a.sessionId } })
  await expect.poll(() => first.events.some(event => event.event === 'session')).toBe(true)
  await first.client.request({ method: 'prompt', params: { sessionId: a.sessionId, text: 'actual prompt', mode: 'steer', requestId: 'request-a' } })
  expect(a.prompts).toHaveBeenCalledOnce(); expect(b.prompts).not.toHaveBeenCalled()
  await expect(first.client.request({ method: 'prompt', params: { sessionId: 'missing', text: 'no', mode: 'steer', requestId: 'request-b' } })).rejects.toThrow('session_not_available')
  first.client.close()
  await second.client.request({ method: 'desktop', params: {} })
})
it('consumes each pairing ticket once, reconnects saved credentials and revokes active devices', async () => {
  const b = await boot(); const offer = await b.offer(); const enrolled = await phone(offer)
  await expect(phone(offer)).rejects.toThrow()
  enrolled.client.close()
  const connected = await phone(enrolled.saved)
  expect(AdminStateSchema.parse(await b.host.admin({ operation: 'state' })).devices).toHaveLength(1)
  await b.host.admin({ operation: 'revoke', deviceId: connected.saved.deviceId })
  await expect(phone(connected.saved)).rejects.toThrow()
  expect(AdminStateSchema.parse(await b.host.admin({ operation: 'state' })).devices).toHaveLength(0)
  const persisted = await readFile(join(b.path, 'host.json'), 'utf8')
  expect(persisted).not.toContain(enrolled.saved.token)
})
it('rejects expired tickets at the Host even when the phone decoded them before expiration', async () => {
  const b = await boot(30); const offer = await b.offer()
  await new Promise(resolve => setTimeout(resolve, 60))
  await expect(phone(offer)).rejects.toThrow('pairing_ticket_invalid')
})
it('rejects wrong Host/session approvals and cancels pending decisions on revocation or request abort', async () => {
  const a = await boot(); const b = await boot()
  const first = await phone(await a.offer()); const second = await phone(await b.offer())
  const controller = new AbortController()
  const decision = a.ctx.waterfall('approval/request', { agent: { id: a.sessionId } as Agent, toolName: 'shell', signal: controller.signal }, async () => 'unavailable' as const)
  await expect.poll(() => first.events.some(event => event.event === 'approval')).toBe(true)
  const approval = first.events.find(event => event.event === 'approval')?.value as Approval
  await expect(second.client.request({ method: 'approval', params: { approvalId: approval.approvalId, sessionId: approval.sessionId, decision: 'allowed-once' } })).rejects.toThrow('approval_not_pending')
  await expect(first.client.request({ method: 'approval', params: { approvalId: approval.approvalId, sessionId: 'other', decision: 'allowed-once' } })).rejects.toThrow('approval_not_pending')
  controller.abort(); expect(await decision).toBe('cancelled')
  await expect(first.client.request({ method: 'approval', params: { approvalId: approval.approvalId, sessionId: approval.sessionId, decision: 'allowed-once' } })).rejects.toThrow('approval_not_pending')
  const pending = a.ctx.waterfall('approval/request', { agent: { id: a.sessionId } as Agent, toolName: 'shell' }, async () => 'unavailable' as const)
  await a.host.admin({ operation: 'revoke', deviceId: first.saved.deviceId })
  expect(await pending).toBe('unavailable')
})
it('pins the Host encryption key and completes only the exact pending approval', async () => {
  const a = await boot(); const offer = await a.offer()
  await expect(phone({ ...offer, publicKey: base64(nacl.box.keyPair().publicKey) })).rejects.toThrow('desktop_identity_changed')
  const enrolled = await phone(offer)
  const decision = a.ctx.waterfall('approval/request', { agent: { id: a.sessionId } as Agent, toolName: 'shell' }, async () => 'unavailable' as const)
  await expect.poll(() => enrolled.events.some(event => event.event === 'approval')).toBe(true)
  const approval = ApprovalSchema.parse(enrolled.events.find(event => event.event === 'approval')?.value)
  await enrolled.client.request({ method: 'approval', params: { approvalId: approval.approvalId, sessionId: approval.sessionId, decision: 'allowed-once' } })
  expect(await decision).toBe('allowed-once')
  await expect(enrolled.client.request({ method: 'approval', params: { approvalId: approval.approvalId, sessionId: approval.sessionId, decision: 'rejected' } })).rejects.toThrow('approval_not_pending')
})
it('rolls back failed relay enrollment without an authenticated peer or durable device', async () => {
  const a = await boot()
  const relay = await startRelay({ port: 0, stateFile: join(a.path, 'director.json') }); relays.push(relay)
  await a.host.admin({ operation: 'save', settings: { name: 'relay-host', mode: 'relay', directorUrl: relay.url } })
  const original = RelayClient.prototype.request
  const control = vi.spyOn(RelayClient.prototype, 'request').mockImplementation(function (this: RelayClient, type, payload) {
    if (type === 'device-install') return Promise.reject(new Error('injected_install_failure'))
    return original.call(this, type, payload)
  })
  await expect(phone(await a.offer())).rejects.toThrow('injected_install_failure')
  expect(AdminStateSchema.parse(await a.host.admin({ operation: 'state' })).devices).toHaveLength(0)
  control.mockRestore()
  const enrolled = await phone(await a.offer())
  expect(enrolled.saved.name).toBe('relay-host')
  await a.host.admin({ operation: 'revoke', deviceId: enrolled.saved.deviceId })
  await expect(phone(enrolled.saved)).rejects.toThrow()
})

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing_test_port')
  await new Promise<void>(resolve => server.close(() => resolve()))
  return address.port
}
it('renews full regional leases and reconnects enrolled phones after cross-Cell failover', async () => {
  const a = await boot(5000, { reconnectMs: 50, handshakeMs: 1000 }); const b = await boot(5000, { reconnectMs: 50, handshakeMs: 1000 })
  const ports = [await freePort(), await freePort()]
  const regions = ports.map((port, index) => ({ id: 'region-' + index, name: 'Cell ' + index, url: 'http://127.0.0.1:' + port, capacity: 2 }))
  const director = await startRelay({ role: 'director', port: 0, stateFile: join(a.path, 'director.json'), regions, leaseMs: 1000, handshakeMs: 600 }); relays.push(director)
  const cells = []
  for (const [index, region] of regions.entries()) {
    const cell = await startRelay({ role: 'cell', port: ports[index], publicUrl: region.url, regionId: region.id, directorUrl: director.url, stateFile: join(a.path, 'cell-' + index), maxHosts: 2, heartbeatMs: 100, handshakeMs: 600 })
    cells.push(cell); relays.push(cell)
  }
  await a.host.admin({ operation: 'save', settings: { name: 'desktop-a', mode: 'relay', directorUrl: director.url, preferredRegion: regions[0]!.id } })
  await b.host.admin({ operation: 'save', settings: { name: 'desktop-b', mode: 'relay', directorUrl: director.url, preferredRegion: regions[1]!.id } })
  const first = await phone(await a.offer()); const second = await phone(await b.offer())
  const resolve = async (hostId: string) => z.object({ region: z.object({ id: z.string() }).passthrough(), epoch: z.number() }).parse(await (await fetch(director.url + '/v1/resolve/' + hostId)).json())
  const initial = await resolve(first.saved.hostId)
  expect(initial.region.id).toBe(regions[0]!.id)
  await new Promise(resolve => setTimeout(resolve, 1500))
  expect((await resolve(first.saved.hostId)).epoch).toBe(initial.epoch)
  await second.client.request({ method: 'desktop', params: {} })
  await cells[0]!.close()
  await expect.poll(async () => (await resolve(first.saved.hostId)).region.id, { timeout: 5000 }).toBe(regions[1]!.id)
  await expect.poll(async () => AdminStateSchema.parse(await a.host.admin({ operation: 'state' })).relayStatus).toBe('online')
  first.client.close()
  const recovered = await phone(first.saved)
  expect((await resolve(first.saved.hostId)).epoch).toBeGreaterThan(initial.epoch)
  await recovered.client.request({ method: 'prompt', params: { sessionId: a.sessionId, text: 'after failover', mode: 'steer', requestId: 'failover' } })
  expect(a.prompts).toHaveBeenCalledOnce(); expect(b.prompts).not.toHaveBeenCalled()
  await second.client.request({ method: 'desktop', params: {} })
  await new Promise(resolve => setTimeout(resolve, 1500))
  expect((await resolve(first.saved.hostId)).region.id).toBe(regions[1]!.id)
}, 15000)
