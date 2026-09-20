/** Only the external Host carrier is replaced; generated Remote codecs and UI run unchanged. */
import { createFixtureFaces } from '@deepseek-ai/dsh-client-connection/src/client/fixture.ts'
import type { ClientTransportHooks, ClientRequest } from '@deepseek-ai/dsh-client-connection/client'
import type { RuntimeTaskValue } from '@deepseek-ai/dsh-api-execution-host-controller/types'
import { baseline, feed, runtimeInspection, runtimeTask } from './fixtures.client.ts'

export function externalRpc() {
  const calls: ClientRequest[] = []
  const rpc = createFixtureFaces().rpc
  const targets = feed(baseline)
  const tasks = feed<RuntimeTaskValue>({ task: runtimeTask })
  let active: RuntimeTaskValue | undefined
  const transport: ClientTransportHooks = {
    ownsHost: true,
    fetch: async (_url, init) => {
      if (typeof init.body !== 'string') throw new Error('Expected JSON request')
      const request = JSON.parse(init.body) as ClientRequest
      calls.push(request)
      let result: unknown
      if (request.method.startsWith('executionHosts/')) {
        let value: unknown
        switch (request.method) {
          case 'executionHosts/list': value = baseline; break
          case 'executionHosts/listRuntimeTasks': value = { tasks: active === undefined ? [] : [active.task] }; break
          case 'executionHosts/detectRuntime': value = runtimeInspection; break
          case 'executionHosts/startRuntime': active = { task: runtimeTask }; value = active; break
          case 'executionHosts/cancelRuntimeTask': active = { task: { ...runtimeTask, state: 'cancelled' } }; tasks.push(active); value = active; break
          default: throw new Error('Unexpected runtime method ' + request.method)
        }
        result = { ok: true, value }
      } else result = await rpc.call('/api', request.method, request.payload, init.signal ?? undefined)
      return new Response(JSON.stringify({ type: 'server-response', rpcId: request.rpcId, result }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    },
    openStream: (endpoint, payload, signal) => endpoint === 'executionHosts/follow' ? targets.open(signal)
      : endpoint === 'executionHosts/followRuntimeTask' ? tasks.open(signal) : rpc.open!('/api', endpoint, payload, signal),
  }
  return { transport, calls }
}
