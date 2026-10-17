/** Authenticated operator commands shared by Web and Desktop carriers. */
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { z } from 'zod'
import { AdminStateSchema, type AdminState, type HostSettings } from '@cinlan/mobile-relay/protocol'

/** Desktop/Web pairing configuration consumer. */
export interface CompanionApi {
  state(signal?: AbortSignal): Promise<AdminState>
  save(settings: HostSettings): Promise<AdminState>
  pair(): Promise<{ pairingUrl: string; expiresAt: number }>
  revoke(deviceId: string): Promise<void>
}

/** Bind to the operator's existing authenticated carrier, never the phone token. */
export function companionApi(rpc: ClientConnectionRpc): CompanionApi {
  const call = async (payload: unknown, signal?: AbortSignal): Promise<unknown> => {
    const result = await rpc.call('/api', 'mobile-admin', payload, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  return {
    state: async signal => AdminStateSchema.parse(await call({ operation: 'state' }, signal)),
    save: async settings => AdminStateSchema.parse(await call({ operation: 'save', settings })),
    pair: async () => z.object({ pairingUrl: z.string(), expiresAt: z.number() }).strict().parse(await call({ operation: 'pair' })),
    revoke: async deviceId => { await call({ operation: 'revoke', deviceId }) },
  }
}
