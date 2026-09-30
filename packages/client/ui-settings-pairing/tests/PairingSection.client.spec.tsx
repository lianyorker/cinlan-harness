// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PairingInvitation, PairingProps, PairingSnapshot, RemoteAccessStatus } from '../src/client/types.ts'
import { PairingSection } from '../src/client/PairingSection.tsx'
import { buildPairingUrl } from '../src/client/pairing-url.ts'
import { en } from '../src/client/locales.ts'

const qr = vi.hoisted(() => ({
  toDataURL: vi.fn(async (_value: string, _options: unknown) => 'data:image/png;base64,pairing-fixture'),
}))
vi.mock('qrcode', () => qr)

const invitation: PairingInvitation = {
  invitationId: 'invite-1' as PairingInvitation['invitationId'],
  code: '482915000',
  expiresAt: 4102444800000,
  sessionIds: ['session-42' as PairingInvitation['sessionIds'][number]],
  scopes: ['session:read'],
}
const status: RemoteAccessStatus = {
  state: 'ready', missingConfiguration: [], origin: 'https://desktop.example:7443', certificateFingerprint: 'AA:BB', devices: [],
}
const sessions = { phase: 'ready' as const, ids: ['session-42'], byId: { 'session-42': { displayTitle: 'Fixture session' } } }

function renderPairing(current: PairingSnapshot = { status, invitation, pending: false, failed: false }) {
  const props = {
    t: (key: string) => en[key as keyof typeof en],
    usePairing: (selector: (value: PairingSnapshot) => unknown) => selector(current),
    usePairingSessions: (selector: (value: typeof sessions) => unknown) => selector(sessions),
    refresh: vi.fn(async () => {}), enable: vi.fn(async () => {}), disable: vi.fn(async () => {}),
    createInvitation: vi.fn(async () => {}), cancelInvitation: vi.fn(async () => {}), revokeDevice: vi.fn(async () => {}),
  } as unknown as PairingProps
  return render(<PairingSection {...props} />)
}

describe('pairing QR payload', () => {
  beforeEach(() => { qr.toDataURL.mockClear() })
  afterEach(cleanup)

  it('uses an HTTPS path and fragment without query, grants, or Session IDs', () => {
    const value = buildPairingUrl('https://desktop.example:7443/?existing=ignored', invitation)
    expect(value).toBe('https://desktop.example:7443/pair#invitationId=invite-1&code=482915000')
    const url = new URL(value!)
    expect(url.search).toBe('')
    expect(url.pathname).toBe('/pair')
    expect(url.hash).toBe('#invitationId=invite-1&code=482915000')
    expect(value).not.toContain('session-42')
    expect(value).not.toContain('session:read')
    const encoded = buildPairingUrl('https://desktop.example:7443', { ...invitation, invitationId: 'invite/one' as PairingInvitation['invitationId'] })
    expect(encoded).toBe('https://desktop.example:7443/pair#invitationId=invite%2Fone&code=482915000')
  })

  it('renders a fixed accessible image and preserves manual values and fingerprint guidance', async () => {
    renderPairing()
    const image = await screen.findByRole('img', { name: en.qrAlt })
    expect(image.getAttribute('src')).toBe('data:image/png;base64,pairing-fixture')
    expect(image.getAttribute('width')).toBe('256')
    expect(image.getAttribute('height')).toBe('256')
    expect(screen.getByText(invitation.invitationId)).toBeTruthy()
    expect(screen.getByText(invitation.code)).toBeTruthy()
    expect(screen.getByText(en.fingerprintHelp)).toBeTruthy()
    expect(qr.toDataURL).toHaveBeenCalledOnce()
    const [value] = qr.toDataURL.mock.calls[0]!
    expect(value).toBe('https://desktop.example:7443/pair#invitationId=invite-1&code=482915000')
  })

  it('ignores a late encoder result after the section unmounts', async () => {
    let resolve!: (value: string) => void
    qr.toDataURL.mockImplementationOnce(() => new Promise<string>((finish) => { resolve = finish }))
    const view = renderPairing()
    await waitFor(() => { expect(qr.toDataURL).toHaveBeenCalledOnce() })
    view.unmount()
    await act(async () => { resolve('data:image/png;base64,late'); await Promise.resolve() })
    expect(screen.queryByRole('img')).toBeNull()
  })
})
