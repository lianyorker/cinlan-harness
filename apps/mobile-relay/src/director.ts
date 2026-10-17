/** Persistent host assignments and signed short-lived Cell leases. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import { base64, digest, hostIdentity, nacl, unbase64, verifyProof } from './crypto.ts'
import { HostIdSchema, ProofSchema, RegionIdSchema, type Assignment, type Region } from './mobile-protocol.ts'
import type { RelayConfig } from './config.ts'

const StateSchema = z.object({ v: z.literal(1), secretKey: z.string(), assignments: z.record(HostIdSchema, z.object({ regionId: RegionIdSchema, epoch: z.number().int().nonnegative(), expiresAt: z.number().int() }).strict()) }).strict()
export const LeaseSchema = z.object({ v: z.literal(1), hostId: HostIdSchema, publicKey: z.string(), regionId: RegionIdSchema, epoch: z.number().int(), expiresAt: z.number().int() }).strict()

/** Atomically replace private routing state without writing credentials to logs. */
export function writePrivateState(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = path + '.' + digest(base64(nacl.randomBytes(32))).slice(0, 16) + '.tmp'
  writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 })
  renameSync(temporary, path)
}

/** Single authoritative Director with independent configured regional Cells. */
export class Director {
  private readonly state: z.infer<typeof StateSchema>
  private readonly secretKey: Uint8Array
  private readonly usedProofs = new Map<string, number>()
  private assigning: Promise<unknown> = Promise.resolve()
  constructor(private readonly config: RelayConfig, private readonly regions: Region[]) {
    try { this.state = StateSchema.parse(JSON.parse(readFileSync(config.stateFile, 'utf8'))) }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      this.state = { v: 1, secretKey: base64(nacl.sign.keyPair().secretKey), assignments: {} }
      writePrivateState(config.stateFile, this.state)
    }
    this.secretKey = unbase64(this.state.secretKey, 64)
  }
  /** Public lease verification key; Cells trust the configured Director's TLS origin. */
  get publicKey(): string { return base64(nacl.sign.keyPair.fromSecretKey(this.secretKey).publicKey) }
  /** Persist a healthy region choice and issue a lease bound to the proven host key. */
  assign(value: unknown): Promise<Assignment> {
    const task = this.assigning.then(() => this.assignHost(value))
    this.assigning = task.catch(() => {})
    return task
  }
  private async assignHost(value: unknown): Promise<Assignment> {
    const request = z.object({ proof: ProofSchema, preferredRegion: z.string().optional() }).strict().parse(value)
    if (!verifyProof(request.proof, 'assign', this.config.handshakeMs)) throw new Error('invalid_host_proof')
    for (const [nonce, expiry] of this.usedProofs) if (expiry < Date.now()) this.usedProofs.delete(nonce)
    if (this.usedProofs.has(request.proof.nonce)) throw new Error('replayed_host_proof')
    if (this.usedProofs.size >= this.config.maxProofs) throw new Error('proof_capacity_reached')
    this.usedProofs.set(request.proof.nonce, Date.now() + this.config.handshakeMs)
    const hostId = hostIdentity(request.proof.publicKey)
    const previous = this.state.assignments[hostId]
    for (const [rawId, assignment] of Object.entries(this.state.assignments)) if (assignment.expiresAt + this.config.leaseMs < Date.now()) delete this.state.assignments[HostIdSchema.parse(rawId)]
    const active = Object.values(this.state.assignments).filter(item => item.expiresAt > Date.now()).length
    if ((!previous || previous.expiresAt <= Date.now()) && active >= this.config.maxHosts) throw new Error('host_capacity_reached')
    const health = await Promise.all(this.regions.map(async (region) => {
      try {
        const response = await fetch(region.url + '/health', { signal: AbortSignal.timeout(this.config.handshakeMs) })
        if (!response.ok) return null
        const status = z.object({ regionId: z.string(), hostIds: z.array(z.string()), role: z.string() }).passthrough().parse(await response.json())
        if (status.regionId !== region.id || status.role === 'director') return null
        const occupied = new Set(status.hostIds)
        for (const [id, assignment] of Object.entries(this.state.assignments)) if (assignment.regionId === region.id && assignment.expiresAt > Date.now()) occupied.add(id)
        if (!occupied.has(hostId) && occupied.size >= region.capacity) return null
        return { region, load: occupied.size / region.capacity }
      } catch (_unavailableCell) { return null }
    }))
    const available = health.filter((item): item is NonNullable<typeof item> => item !== null)
    const selected = available.find(item => item.region.id === request.preferredRegion)
      ?? available.find(item => item.region.id === previous?.regionId)
      ?? available.sort((a, b) => a.load - b.load)[0]
    if (!selected) throw new Error('no_healthy_region')
    const epoch = (previous?.epoch ?? 0) + (previous?.regionId !== selected.region.id ? 1 : 0)
    const expiresAt = Date.now() + this.config.leaseMs
    this.state.assignments[hostId] = { regionId: selected.region.id, epoch, expiresAt }
    try { writePrivateState(this.config.stateFile, this.state) }
    catch (error) { if (previous) this.state.assignments[hostId] = previous; else delete this.state.assignments[hostId]; throw error }
    const body = base64(new TextEncoder().encode(JSON.stringify({ v: 1, hostId, publicKey: request.proof.publicKey, regionId: selected.region.id, epoch, expiresAt })))
    const lease = body + '.' + base64(nacl.sign.detached(new TextEncoder().encode(body), this.secretKey))
    return { v: 1, hostId, region: selected.region, epoch, expiresAt, lease }
  }
  /** Resolve a saved routing identity without exposing device credentials. */
  resolve(hostId: string): { region: Region; epoch: number } {
    const identity = HostIdSchema.parse(hostId)
    const assignment = this.state.assignments[identity]
    const region = this.regions.find(item => item.id === assignment?.regionId)
    if (!region || !assignment || assignment.expiresAt <= Date.now()) throw new Error('host_not_assigned')
    return { region, epoch: assignment.epoch }
  }
}

/** Verify a lease against the configured Director before registering a control socket. */
export function verifyLease(token: string, directorKey: string, regionId: string): z.infer<typeof LeaseSchema> {
  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1] || token.length > 4096) throw new Error('invalid_lease')
  if (!nacl.sign.detached.verify(new TextEncoder().encode(parts[0]), unbase64(parts[1], 64), unbase64(directorKey, 32))) throw new Error('invalid_lease_signature')
  const lease = LeaseSchema.parse(JSON.parse(new TextDecoder().decode(unbase64(parts[0]))))
  if (lease.regionId !== regionId || lease.expiresAt <= Date.now() || lease.hostId !== hostIdentity(lease.publicKey)) throw new Error('lease_expired_or_misrouted')
  return lease
}
