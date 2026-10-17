/** NaCl authenticated channels with pinned desktop keys and direction-specific counters. */
import nacl from 'tweetnacl'
import { z } from 'zod'
import type { Proof, HostId } from './mobile-protocol.ts'
import { brandString } from '@deepseek-ai/dsh-brand'

const ContextSchema = z.object({ hostId: z.string().min(1).max(128), transport: z.enum(['direct', 'relay']) }).strict()
export const HelloSchema = z.object({ type: z.literal('e2ee_hello'), v: z.literal(1), publicKey: z.string().length(44), nonce: z.string().length(44), context: ContextSchema }).strict()
export const ReadySchema = z.object({ type: z.literal('e2ee_ready'), v: z.literal(1), publicKey: z.string().length(44), nonce: z.string().length(44), clientNonce: z.string().length(44), context: ContextSchema }).strict()
const CipherSchema = z.object({ type: z.literal('cipher'), data: z.string().max(2 * 1024 * 1024) }).strict()
const PlainSchema = z.object({ seq: z.number().int().nonnegative(), payload: z.unknown() }).strict()

/** Encode bytes identically in Node and browsers. */
export function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary)
}
/** Decode a canonical key or frame and optionally require a byte length. */
export function unbase64(value: string, length?: number): Uint8Array {
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0))
  if (base64(bytes) !== value || (length !== undefined && bytes.length !== length)) throw new Error('invalid_base64')
  return bytes
}
/** Mint a cryptographically random opaque credential; never log the result. */
export function randomSecret(): string { return base64(nacl.randomBytes(32)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
/** Hash a credential for durable storage and relay admission. */
export function digest(value: string): string { return base64(nacl.hash(new TextEncoder().encode(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
/** Derive a stable routing identity from a host signing public key. */
export function hostIdentity(publicKey: string): HostId { return brandString<HostId>(digest(publicKey).slice(0, 32)) }
/** Create a signed, purpose-bound registration proof. */
export function createProof(purpose: Proof['purpose'], secretKey: Uint8Array): Proof {
  const publicKey = base64(nacl.sign.keyPair.fromSecretKey(secretKey).publicKey)
  const proof = { purpose, publicKey, nonce: randomSecret(), time: Date.now() }
  return { ...proof, signature: base64(nacl.sign.detached(new TextEncoder().encode(JSON.stringify(proof)), secretKey)) }
}
/** Verify possession, purpose and freshness before accepting a routing identity. */
export function verifyProof(proof: Proof, purpose: Proof['purpose'], maxAgeMs: number): boolean {
  if (proof.purpose !== purpose || Math.abs(Date.now() - proof.time) > maxAgeMs) return false
  try {
    const { signature, ...body } = proof
    return nacl.sign.detached.verify(new TextEncoder().encode(JSON.stringify(body)), unbase64(signature, 64), unbase64(proof.publicKey, 32))
  } catch (_invalidProof) { return false }
}

/** One physical connection; fresh nonces separate reconnects and keys separate directions. */
export class EncryptedChannel {
  private sent = 0
  private received = 0
  private readonly outgoing: Uint8Array
  private readonly incoming: Uint8Array
  constructor(secretKey: Uint8Array, peerKey: string, clientNonce: string, hostNonce: string, role: 'host' | 'phone', context: z.infer<typeof ContextSchema>) {
    const peer = unbase64(peerKey, 32)
    if (nacl.scalarMult(secretKey, peer).every(byte => byte === 0)) throw new Error('invalid_peer_key')
    const shared = nacl.box.before(peer, secretKey)
    unbase64(clientNonce, 32); unbase64(hostNonce, 32)
    const ownKey = base64(nacl.box.keyPair.fromSecretKey(secretKey).publicKey)
    const keys = role === 'host' ? [peerKey, ownKey] : [ownKey, peerKey]
    const derive = (direction: string): Uint8Array => {
      const transcript = new TextEncoder().encode(JSON.stringify(['cinlan-mobile/v1', direction, ...keys, clientNonce, hostNonce, context.hostId, context.transport]))
      const bytes = new Uint8Array(shared.length + transcript.length)
      bytes.set(shared); bytes.set(transcript, shared.length)
      return nacl.hash(bytes).slice(0, 32)
    }
    this.outgoing = derive(role === 'host' ? 'host-phone' : 'phone-host')
    this.incoming = derive(role === 'host' ? 'phone-host' : 'host-phone')
  }
  /** Encrypt one payload with an authenticated monotonically increasing sequence. */
  encode(payload: unknown): string {
    if (!Number.isSafeInteger(this.sent)) throw new Error('sequence_exhausted')
    const body = new TextEncoder().encode(JSON.stringify({ seq: this.sent, payload }))
    if (body.byteLength > 512 * 1024) throw new Error('frame_too_large')
    this.sent++
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
    const cipher = nacl.secretbox(body, nonce, this.outgoing)
    const data = new Uint8Array(nonce.length + cipher.length)
    data.set(nonce); data.set(cipher, nonce.length)
    return JSON.stringify({ type: 'cipher', data: base64(data) })
  }
  /** Reject forged, replayed, reordered or oversized frames. */
  decode(raw: string): unknown {
    const frame = CipherSchema.parse(JSON.parse(raw))
    const data = unbase64(frame.data)
    const plain = nacl.secretbox.open(data.slice(24), data.slice(0, 24), this.incoming)
    if (plain === null || plain.byteLength > 512 * 1024) throw new Error('invalid_cipher')
    const body = PlainSchema.parse(JSON.parse(new TextDecoder().decode(plain)))
    if (body.seq !== this.received) throw new Error('invalid_sequence')
    this.received++
    return body.payload
  }
}

export { nacl }
