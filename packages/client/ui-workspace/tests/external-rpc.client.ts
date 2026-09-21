/** External Host fixture; real generated Client Remote owns request decoding. */
import { createFixtureFaces } from '@deepseek-ai/dsh-client-connection/src/client/fixture.ts'
import type { ClientTransportHooks, ClientRequest } from '@deepseek-ai/dsh-client-connection/client'
import type { ListTargetsValue, TargetView } from '@deepseek-ai/dsh-api-execution-host-controller/types'

export const target: TargetView = {
  id: 'remote-target' as TargetView['id'], revision: 4, label: 'Remote Linux', sshAlias: 'inspect-linux',
  createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', state: { phase: 'disconnected' },
  execution: { endpoint: { host: 'linux.example', port: 22, username: 'operator', privateKeyFile: 'C:/keys/private', hostKeySHA256: 'SHA256:pin' },
    node: '/usr/bin/node', helper: '/opt/runtime/helper', helperHash: 'a'.repeat(64), workspace: '/srv/work',
    bootstrapPath: '/opt/runtime/bootstrap', bootstrapHash: 'b'.repeat(64) },
}
export function externalRpc() {
  const calls: ClientRequest[] = []
  const rpc = createFixtureFaces().rpc
  const baseline: ListTargetsValue = { targets: [target], current: {
    hostId: 'local' as ListTargetsValue['current']['hostId'], hostname: 'desktop', pid: 1, platform: 'win32', createdAt: '2026-09-01T10:00:00.000Z',
  } }
  const queue: ListTargetsValue[] = []
  let wake: (() => void) | undefined
  const targets = { push(value: ListTargetsValue) { queue.push(value); wake?.() } }
  async function* follow(signal: AbortSignal) {
    const abort = (): void => { wake?.() }
    signal.addEventListener('abort', abort)
    try {
      yield baseline
      while (!signal.aborted) {
        const next = queue.shift()
        if (next !== undefined) { yield next; continue }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally { signal.removeEventListener('abort', abort) }
  }
  const transport: ClientTransportHooks = {
    ownsHost: true,
    fetch: async (_url, init) => {
      if (typeof init.body !== 'string') throw new Error('Expected JSON request')
      const request = JSON.parse(init.body) as ClientRequest
      calls.push(request)
      const result = request.method === 'executionHosts/list' ? { ok: true, value: baseline }
        : await rpc.call('/api', request.method, request.payload, init.signal ?? undefined)
      return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    },
    openStream: (endpoint, payload, signal) => endpoint === 'executionHosts/follow' ? follow(signal) : rpc.open!('/api', endpoint, payload, signal),
  }
  return { transport, calls, targets, baseline }
}
