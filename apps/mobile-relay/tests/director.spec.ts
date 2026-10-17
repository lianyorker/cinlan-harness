/** Real Cell health probes with durable capacity reservations and lease verification. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { startRelay } from '../src/runtime.ts'
import { Director, verifyLease } from '../src/director.ts'
import { RelayConfigSchema } from '../src/config.ts'
import { RegionSchema } from '../src/mobile-protocol.ts'
import { createProof, nacl } from '../src/crypto.ts'

const nodes: Awaited<ReturnType<typeof startRelay>>[] = []
const paths: string[] = []
afterEach(async () => { for (const node of nodes.splice(0)) await node.close(); for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true }) })
it('reserves regional capacity atomically, renews a full Cell and rejects replay or expired leases', async () => {
  const path = await mkdtemp(join(tmpdir(), 'cinlan-director-test-')); paths.push(path)
  const regions = []
  for (let index = 0; index < 2; index++) {
    const node = await startRelay({ port: 0, regionId: 'region-' + index, stateFile: join(path, 'health-' + index) }); nodes.push(node)
    regions.push(RegionSchema.parse({ id: 'region-' + index, name: 'Cell', url: node.url, capacity: 1 }))
  }
  const config = RelayConfigSchema.parse({ stateFile: join(path, 'director.json'), maxHosts: 10, leaseMs: 200, handshakeMs: 500 })
  const director = new Director(config, regions)
  const keys = [nacl.sign.keyPair(), nacl.sign.keyPair(), nacl.sign.keyPair()]
  const proof = createProof('assign', keys[0]!.secretKey)
  const [first, second] = await Promise.all([director.assign({ proof }), director.assign({ proof: createProof('assign', keys[1]!.secretKey) })])
  expect(first.region.id).not.toBe(second.region.id)
  await expect(director.assign({ proof })).rejects.toThrow('replayed_host_proof')
  await expect(director.assign({ proof: createProof('assign', keys[2]!.secretKey) })).rejects.toThrow('no_healthy_region')
  const renewed = await director.assign({ proof: createProof('assign', keys[0]!.secretKey) })
  expect(renewed.region.id).toBe(first.region.id)
  expect(verifyLease(renewed.lease, director.publicKey, first.region.id).hostId).toBe(first.hostId)
  expect(() => verifyLease(renewed.lease, director.publicKey, second.region.id)).toThrow('lease_expired_or_misrouted')
  expect(new Director(config, regions).resolve(first.hostId).region.id).toBe(first.region.id)
  await new Promise(resolve => setTimeout(resolve, 250))
  expect(() => director.resolve(first.hostId)).toThrow('host_not_assigned')
  expect(() => verifyLease(renewed.lease, director.publicKey, first.region.id)).toThrow('lease_expired_or_misrouted')
})
