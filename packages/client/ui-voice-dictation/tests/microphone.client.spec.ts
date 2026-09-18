// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readMicrophonePermission, requestMicrophonePermission, resetStoredMicrophonePermission } from '../src/client/microphone.ts'

afterEach(() => {
  resetStoredMicrophonePermission()
  vi.unstubAllGlobals()
})

describe('requestMicrophonePermission', () => {

  it('resolves granted and stops every track on success', async () => {
    const stop = vi.fn()
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop }, { stop }] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    await expect(requestMicrophonePermission()).resolves.toBe('granted')
    expect(stop).toHaveBeenCalledTimes(2)
  })

  it('persists denied only for a permission rejection', async () => {
    const getUserMedia = vi.fn(async () => { throw new DOMException('denied by user', 'NotAllowedError') })
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    await expect(requestMicrophonePermission()).resolves.toBe('denied')
    vi.stubGlobal('navigator', {})
    await expect(readMicrophonePermission()).resolves.toBe('denied')
  })

  it('does not replace a known permission after a non-permission media failure', async () => {
    const stop = vi.fn()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } })
    await expect(requestMicrophonePermission()).resolves.toBe('granted')
    const getUserMedia = vi.fn(async () => { throw new DOMException('no input device', 'NotFoundError') })
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    await expect(requestMicrophonePermission()).resolves.toBe('granted')
    vi.stubGlobal('navigator', {})
    await expect(readMicrophonePermission()).resolves.toBe('granted')
  })

  it('returns unknown when media capture is unavailable and no permission is known', async () => {
    vi.stubGlobal('navigator', {})
    await expect(requestMicrophonePermission()).resolves.toBe('unknown')
  })
})

describe('readMicrophonePermission', () => {
  it('resolves unknown when the Permissions API and stored fallback are absent', async () => {
    vi.stubGlobal('navigator', {})
    await expect(readMicrophonePermission()).resolves.toBe('unknown')
  })

  it('persists a successful request and restores it when the Permissions API is absent', async () => {
    const stop = vi.fn()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } })
    await expect(requestMicrophonePermission()).resolves.toBe('granted')
    vi.stubGlobal('navigator', {})
    await expect(readMicrophonePermission()).resolves.toBe('granted')
  })

  it('clears a stale grant when Permissions reports prompt', async () => {
    const stop = vi.fn()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } })
    await requestMicrophonePermission()
    vi.stubGlobal('navigator', { permissions: { query: vi.fn(async () => ({ state: 'prompt' })) } })
    await expect(readMicrophonePermission()).resolves.toBe('unknown')
    vi.stubGlobal('navigator', {})
    await expect(readMicrophonePermission()).resolves.toBe('unknown')
  })

  it('resolves granted/denied from a successful Permissions query', async () => {
    const query = vi.fn(async () => ({ state: 'granted' }))
    vi.stubGlobal('navigator', { permissions: { query } })
    await expect(readMicrophonePermission()).resolves.toBe('granted')
  })

  it('falls back to the persisted result when the Permissions query rejects', async () => {
    const stop = vi.fn()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } })
    await requestMicrophonePermission()
    const query = vi.fn(async () => { throw new Error('unsupported') })
    vi.stubGlobal('navigator', { permissions: { query } })
    await expect(readMicrophonePermission()).resolves.toBe('granted')
  })
})
