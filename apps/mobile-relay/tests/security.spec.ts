/** Negative tests for connection-bound encryption and signed routing grants. */
import { expect, it } from 'vitest'
import { EncryptedChannel, base64, createProof, nacl, verifyProof } from '../src/crypto.ts'
import { decodeOffer, encodeOffer } from '../src/mobile-protocol.ts'

function channels() {
  const host = nacl.box.keyPair(); const phone = nacl.box.keyPair()
  const clientNonce = base64(nacl.randomBytes(32)); const hostNonce = base64(nacl.randomBytes(32))
  const context = { hostId: 'desktop', transport: 'direct' as const }
  return {
    host: new EncryptedChannel(host.secretKey, base64(phone.publicKey), clientNonce, hostNonce, 'host', context),
    phone: new EncryptedChannel(phone.secretKey, base64(host.publicKey), clientNonce, hostNonce, 'phone', context),
    other: new EncryptedChannel(phone.secretKey, base64(host.publicKey), clientNonce, base64(nacl.randomBytes(32)), 'phone', context),
    relay: new EncryptedChannel(phone.secretKey, base64(host.publicKey), clientNonce, hostNonce, 'phone', { ...context, transport: 'relay' }),
    wrongHost: new EncryptedChannel(phone.secretKey, base64(host.publicKey), clientNonce, hostNonce, 'phone', { ...context, hostId: 'other' }),
  }
}
it('rejects reflection, replay, reordering and frames from another physical connection', () => {
  const c = channels(); const frame = c.host.encode({ message: 'payload' })
  expect(() => c.host.decode(frame)).toThrow('invalid_cipher')
  expect(() => c.other.decode(frame)).toThrow('invalid_cipher')
  expect(() => c.relay.decode(frame)).toThrow('invalid_cipher')
  expect(() => c.wrongHost.decode(frame)).toThrow('invalid_cipher')
  expect(c.phone.decode(frame)).toEqual({ message: 'payload' })
  expect(() => c.phone.decode(frame)).toThrow('invalid_sequence')
  const next = c.host.encode('next'); const later = c.host.encode('later')
  expect(() => c.phone.decode(later)).toThrow('invalid_sequence')
  expect(c.phone.decode(next)).toBe('next')
  expect(c.phone.decode(later)).toBe('later')
})
it('handles bounded large payloads and refuses low-order peer keys', () => {
  const c = channels(); const text = 'x'.repeat(300000)
  expect(c.phone.decode(c.host.encode(text))).toBe(text)
  expect(() => c.host.encode('x'.repeat(600000))).toThrow('frame_too_large')
  expect(() => new EncryptedChannel(nacl.box.keyPair().secretKey, base64(new Uint8Array(32)), base64(nacl.randomBytes(32)), base64(nacl.randomBytes(32)), 'host', { hostId: 'desktop', transport: 'direct' })).toThrow('invalid_peer_key')
})
it('binds proofs to purpose and freshness and rejects expired pairing offers', () => {
  const keys = nacl.sign.keyPair(); const proof = createProof('assign', keys.secretKey)
  expect(verifyProof(proof, 'assign', 10000)).toBe(true)
  expect(verifyProof(proof, 'control', 10000)).toBe(false)
  expect(verifyProof({ ...proof, time: Date.now() - 20000 }, 'assign', 10000)).toBe(false)
  const offer = { v: 1 as const, hostId: 'host', name: 'desktop', publicKey: base64(nacl.box.keyPair().publicKey), ticket: base64(nacl.randomBytes(32)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), expiresAt: Date.now() - 1, directUrl: 'ws://127.0.0.1/mobile' }
  expect(() => decodeOffer(encodeOffer(offer))).toThrow('pairing_code_expired')
})
