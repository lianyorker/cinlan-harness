/** Client factory for supervised sidebar terminal transport scopes. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-sidebar-terminal-controller/remote'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { createTerminalTransport } from './terminal-client.ts'
import type { TerminalCallbacks } from '../types.ts'

export type { TerminalCallbacks } from '../types.ts'

/** Required Client Remote and Connection services. */
export const inject = ['remote', 'remote.sidebarTerminals', 'connection']

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Create one owned React-free sidebar terminal transport scope. */
    sidebarTerminalClient: () => TerminalCallbacks
  }
}

/**
 * Install the factory used by each sidebar UI activation.
 * @param ctx - Client root Context.
 */
export function apply(ctx: Context): void {
  const remote = ctx.remote.sidebarTerminals
  // The Client provider exposes ConnectionHandle without augmenting Context.
  const connection = ctx.get('connection') as ConnectionHandle
  const lifetime = new AbortController()
  const scopes = new Set<TerminalCallbacks>()
  const create = (): TerminalCallbacks => {
    lifetime.signal.throwIfAborted()
    const transport = createTerminalTransport(remote, connection)
    let cleanup: Promise<void> | undefined
    const scope: TerminalCallbacks = {
      ...transport,
      dispose: () => cleanup ??= transport.dispose().finally(() => { scopes.delete(scope) }),
    }
    scopes.add(scope)
    return scope
  }
  const withdraw = ctx.provide('sidebarTerminalClient', create)
  ctx.effect(() => async () => {
    withdraw()
    lifetime.abort()
    const results = await Promise.allSettled([...scopes].map(scope => scope.dispose()))
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason as unknown)
    if (failures.length > 0) throw new AggregateError(failures, 'Sidebar terminal Client scope disposal failed')
  }, 'sidebar-terminal-controller.client')
}
