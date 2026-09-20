/** External Host RPC fixture only; production Client models, codecs and UI stay real. */
import { createFixtureFaces } from '@deepseek-ai/dsh-client-connection/src/client/fixture.ts'
import type { ClientTransportHooks, ClientRequest } from '@deepseek-ai/dsh-client-connection/client'
import type { PairedDevice, PairingGrant, PairingInvitation, RemoteAccessStatus } from '@deepseek-ai/dsh-remote-access/types'

export const device: PairedDevice = {
  deviceId: 'device-1' as PairedDevice['deviceId'], displayName: 'Test phone',
  sessionIds: ['fx-alpha' as PairingGrant['sessionIds'][number]], scopes: ['session:read'],
  createdAt: 1800000000000, expiresAt: 4102444800000, revokedAt: null,
}
export function externalRpc(initial: RemoteAccessStatus['state'] = 'disabled', paired = false) {
  const calls: ClientRequest[] = []
  const rpc = createFixtureFaces().rpc
  let status: RemoteAccessStatus = {
    state: initial, missingConfiguration: initial === 'not-configured' ? ['advertisedOrigin', 'tlsCertificatePath', 'tlsPrivateKeyPath'] : [],
    origin: initial === 'not-configured' ? null : 'https://desktop.example:7443',
    certificateFingerprint: initial === 'ready' ? 'AA:BB' : null, devices: [device],
  }
  let fail = false
  const transport: ClientTransportHooks = {
    ownsHost: !paired, ...(paired ? { authority: 'paired' as const } : {}),
    fetch: async (_url, init) => {
      if (typeof init.body !== 'string') throw new Error('External RPC fixture requires a JSON body')
      const request = JSON.parse(init.body) as ClientRequest
      calls.push(request)
      let result: unknown
      if (request.method.startsWith('pairing/')) {
        let value: unknown
        const args = (request.payload as { args: { request?: PairingGrant | { deviceId: string } } }).args
        switch (request.method) {
          case 'pairing/describe': value = status; break
          case 'pairing/enable':
            status = { ...status, state: status.missingConfiguration.length === 0 ? 'ready' : 'not-configured' }
            value = status
            break
          case 'pairing/disable': status = { ...status, state: 'disabled' }; value = status; break
          case 'pairing/createInvitation': value = {
            ...(args.request as PairingGrant), invitationId: 'invite-1', code: '482915', expiresAt: Date.now() + 60000,
          } satisfies Omit<PairingInvitation, 'invitationId'> & { invitationId: string }; break
          case 'pairing/cancelInvitation': value = undefined; break
          case 'pairing/revokeDevice':
            status = { ...status, devices: status.devices.map(row => ({ ...row, revokedAt: 1800000001000 })) }
            value = undefined
            break
          default: throw new Error('Unrecognized pairing method in external fixture')
        }
        result = fail ? { ok: false, error: { code: 'gateway/internal', message: 'fixture failure', details: {} } } : { ok: true, value }
      } else {
        result = await rpc.call('/api', request.method, request.payload, init.signal ?? undefined)
      }
      return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    },
    openStream: (endpoint, payload, signal) => rpc.open!('/api', endpoint, payload, signal),
  }
  return { transport, calls, fail: () => { fail = true } }
}
