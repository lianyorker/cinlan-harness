/** Build the HTTPS pairing URL without placing invitation secrets in its request URL. */
import type { PairingInvitation } from '@deepseek-ai/dsh-remote-access/types'

/**
 * Build the one-time pairing URL consumed by the phone form and QR encoder.
 * @param origin - listener origin reported by the authenticated Desktop Host.
 * @param invitation - transient invitation fields permitted in the QR payload.
 * @returns an HTTPS `/pair` URL with only invitation fields in its fragment, or undefined for an invalid origin.
 */
export function buildPairingUrl(origin: string, invitation: Pick<PairingInvitation, 'invitationId' | 'code'>): string | undefined {
  try {
    const url = new URL('/pair', origin)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return undefined
    url.search = ''
    url.hash = new URLSearchParams({ invitationId: invitation.invitationId, code: invitation.code }).toString()
    return url.href
  } catch {
    return undefined
  }
}
