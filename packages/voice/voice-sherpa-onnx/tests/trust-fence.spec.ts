import { describe, expect, it } from 'vitest'
import { isLoopbackHostname, isTrustedVoiceApiRequest } from '../src/trust-fence.ts'

describe('isLoopbackHostname', () => {
  it('accepts localhost, IPv6 loopback, and 127.x.x.x', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('127.255.255.255')).toBe(true)
  })

  it('rejects a non-loopback hostname', () => {
    expect(isLoopbackHostname('example.com')).toBe(false)
    expect(isLoopbackHostname('10.0.0.1')).toBe(false)
    expect(isLoopbackHostname('999.0.0.1')).toBe(false)
  })
})

describe('isTrustedVoiceApiRequest', () => {
  it('accepts a loopback request with no origin', () => {
    expect(isTrustedVoiceApiRequest({ host: '127.0.0.1:5173' })).toBe(true)
  })

  it('accepts a same-origin loopback request', () => {
    expect(isTrustedVoiceApiRequest({ host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173' })).toBe(true)
  })

  it('rejects a missing host header', () => {
    expect(isTrustedVoiceApiRequest({})).toBe(false)
  })

  it('rejects a non-loopback host', () => {
    expect(isTrustedVoiceApiRequest({ host: 'example.com' })).toBe(false)
  })

  it('rejects an explicit cross-site fetch marker', () => {
    expect(isTrustedVoiceApiRequest({ host: '127.0.0.1:5173', 'sec-fetch-site': 'cross-site' })).toBe(false)
  })

  it('rejects a cross-origin origin header', () => {
    expect(isTrustedVoiceApiRequest({ host: '127.0.0.1:5173', origin: 'http://evil.example' })).toBe(false)
  })

  it('rejects a malformed origin header', () => {
    expect(isTrustedVoiceApiRequest({ host: '127.0.0.1:5173', origin: 'not a url' })).toBe(false)
  })
})
