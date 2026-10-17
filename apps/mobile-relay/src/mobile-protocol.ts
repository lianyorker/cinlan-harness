/** Versioned Cinlan pairing, control and encrypted application messages. */
import { z } from 'zod'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Desktop signing-key identity. */
export type HostId = Branded<'CinlanHostId'>
/** Enrolled device identity, scoped to its Host. */
export type DeviceId = Branded<'CinlanDeviceId'>
/** Self-hosted routing region identity. */
export type RegionId = Branded<'CinlanRegionId'>
/** Physical relay connection identity. */
export type ConnectionId = Branded<'CinlanConnectionId'>
/** Mobile approval identity, scoped to its Host and Session. */
export type ApprovalId = Branded<'CinlanApprovalId'>
/** Session identity shares the Harness nominal type. */
export type MobileSessionId = Branded<'SessionId'>
/** Workspace identity shares the Harness nominal type. */
export type MobileWorkspaceId = Branded<'WorkspaceId'>

const id = z.string().min(1).max(128)
export const HostIdSchema = id.transform(brandString<HostId>)
export const DeviceIdSchema = id.transform(brandString<DeviceId>)
export const RegionIdSchema = id.transform(brandString<RegionId>)
export const ConnectionIdSchema = id.transform(brandString<ConnectionId>)
export const ApprovalIdSchema = id.transform(brandString<ApprovalId>)
export const SessionIdSchema = id.transform(brandString<MobileSessionId>)
export const WorkspaceIdSchema = id.transform(brandString<MobileWorkspaceId>)
const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
export const ProofSchema = z.object({ purpose: z.enum(['assign', 'control']), publicKey: z.string().length(44), nonce: secret, time: z.number().int(), signature: z.string().max(100) }).strict()
export const RegionSchema = z.object({ id: RegionIdSchema, name: z.string().min(1).max(128), url: z.string().url(), capacity: z.number().int().positive().default(1000) }).strict()
export const AssignmentSchema = z.object({ v: z.literal(1), hostId: HostIdSchema, region: RegionSchema, epoch: z.number().int().nonnegative(), expiresAt: z.number().int(), lease: z.string().max(4096) }).strict()
export const PairingOfferSchema = z.object({ v: z.literal(1), hostId: HostIdSchema, name: z.string().min(1).max(128), publicKey: z.string().length(44), ticket: secret, expiresAt: z.number().int(), directUrl: z.string().url().optional(), relay: z.object({ directorUrl: z.string().url(), cellUrl: z.string().url(), invite: secret }).strict().optional() }).strict().refine(offer => !!offer.directUrl !== !!offer.relay, 'exactly_one_transport_required')
export const HostSettingsSchema = z.object({ name: z.string().min(1).max(128), mode: z.enum(['local', 'lan', 'relay']), directorUrl: z.string().default(''), preferredRegion: z.string().default(''), address: z.string().default('') }).strict()
export const DesktopSchema = z.object({ hostId: HostIdSchema, name: z.string(), os: z.string(), sessions: z.array(z.object({ id: SessionIdSchema, title: z.string(), cwd: z.string(), running: z.boolean(), updatedAt: z.number() }).strict()), workspaces: z.array(z.object({ id: WorkspaceIdSchema, name: z.string(), path: z.string(), sessionIds: z.array(SessionIdSchema) }).strict()) }).strict()
export const ApprovalSchema = z.object({ approvalId: ApprovalIdSchema, sessionId: SessionIdSchema, toolName: z.string(), reason: z.string(), callId: z.string().optional(), createdAt: z.number() }).strict()
export const AppRequestSchema = z.discriminatedUnion('method', [
  z.object({ id, method: z.literal('auth'), params: z.object({ ticket: secret.optional(), deviceId: DeviceIdSchema.optional(), token: secret.optional(), name: z.string().min(1).max(128) }).strict().refine(params => params.ticket ? !params.deviceId && !params.token : !!params.deviceId && !!params.token, 'invalid_auth_credentials') }).strict(),
  z.object({ id, method: z.literal('desktop'), params: z.object({}).strict() }).strict(),
  z.object({ id, method: z.literal('subscribe'), params: z.object({ sessionId: SessionIdSchema }).strict() }).strict(),
  z.object({ id, method: z.literal('prompt'), params: z.object({ sessionId: SessionIdSchema, text: z.string().trim().min(1).max(32768), mode: z.enum(['queue', 'steer']), requestId: id.transform(brandString<Branded<'session-request-id'>>) }).strict() }).strict(),
  z.object({ id, method: z.literal('create'), params: z.object({ workspaceId: WorkspaceIdSchema.optional(), title: z.string().trim().min(1).max(256).optional() }).strict() }).strict(),
  z.object({ id, method: z.literal('approval'), params: z.object({ approvalId: ApprovalIdSchema, sessionId: SessionIdSchema, decision: z.enum(['allowed-once', 'rejected']) }).strict() }).strict(),
])
export const DeviceSchema = z.object({ id: DeviceIdSchema, name: z.string(), createdAt: z.number(), lastSeenAt: z.number() }).strict()
export const AdminStateSchema = z.object({ hostId: HostIdSchema, settings: HostSettingsSchema, addresses: z.array(z.string()), port: z.number(), devices: z.array(DeviceSchema), relayStatus: z.string(), regions: z.array(RegionSchema) }).strict()
export const AuthResultSchema = z.object({ deviceId: DeviceIdSchema, token: secret.optional(), relayToken: secret.optional(), desktop: DesktopSchema }).strict()
export const ResponseSchema = z.object({ type: z.literal('response'), id, ok: z.boolean(), value: z.unknown().optional(), error: z.string().optional() }).strict()
export const EventSchema = z.object({ type: z.literal('event'), event: z.enum(['desktop', 'session', 'approval', 'approval-settled']), sessionId: SessionIdSchema.optional(), value: z.unknown() }).strict()
export type PairingOffer = z.infer<typeof PairingOfferSchema>
export type HostSettings = z.infer<typeof HostSettingsSchema>
export type Desktop = z.infer<typeof DesktopSchema>
export type AppRequest = z.infer<typeof AppRequestSchema>
/** Unparsed JSON command accepted at the mobile serializer. */
export type AppCommand = z.input<typeof AppRequestSchema>
export type Region = z.infer<typeof RegionSchema>
export type Assignment = z.infer<typeof AssignmentSchema>
export type Proof = z.infer<typeof ProofSchema>
export type AdminState = z.infer<typeof AdminStateSchema>
export type Approval = z.infer<typeof ApprovalSchema>

/** Encode the same offer for QR scanning and manual paste. */
export function encodeOffer(offer: PairingOffer, mobileUrl?: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify(PairingOfferSchema.parse(offer)))
  const code = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  if (!mobileUrl) return 'cinlan://pair?code=' + code
  const url = new URL(mobileUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('invalid_mobile_url')
  url.hash = 'pair=' + code
  return url.toString()
}

/** Parse only Cinlan pairing links or their bounded encoded offer. */
export function decodeOffer(input: string): PairingOffer {
  if (input.length > 8192) throw new Error('pairing_code_too_large')
  let code = input.trim()
  if (code.includes('://')) {
    let url: URL
    try { url = new URL(code) }
    catch (_invalidUrl) { throw new Error('invalid_pairing_link') }
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) code = new URLSearchParams(url.hash.slice(1)).get('pair') ?? ''
    else {
      if (url.protocol !== 'cinlan:' || url.hostname !== 'pair' || (url.pathname !== '' && url.pathname !== '/')) throw new Error('invalid_pairing_link')
      code = url.searchParams.get('code') ?? ''
    }
  }
  if (!/^[A-Za-z0-9_-]+$/.test(code)) throw new Error('invalid_pairing_code')
  let offer: PairingOffer
  try {
    const bytes = Uint8Array.from(atob(code.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    offer = PairingOfferSchema.parse(JSON.parse(new TextDecoder().decode(bytes)))
  } catch (_invalidPairingCode) { throw new Error('invalid_pairing_code') }
  if (offer.expiresAt <= Date.now()) throw new Error('pairing_code_expired')
  return offer
}

/** Convert an HTTP origin to its WebSocket counterpart without credentials. */
export function socketUrl(origin: string, path: string): string {
  const url = new URL(origin)
  if (url.username || url.password || !['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) throw new Error('invalid_endpoint')
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:'
  url.pathname = path
  url.search = ''; url.hash = ''
  return url.toString()
}
