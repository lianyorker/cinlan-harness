/** Read-only root-scope MCP observations contributed by connection launchers. @module */
import { Service, type Context } from '@deepseek-ai/cordis'
import { notifyObservers } from './observation.ts'
import type { ConnectionHandle, McpConnectionId, McpConnectionSnapshot } from './types.ts'

export type { McpConnectionSnapshot } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcpRegistry: McpRegistry
  }
}

import { connectionContribution } from './registry-internal.ts'
import type { ConnectionIdentity } from './registry-internal.ts'

/** Root/profile connection catalog; Agent-scoped launchers do not contribute. */
export class McpRegistry extends Service {
  private readonly records = new Map<McpConnectionId, McpConnectionSnapshot>()
  private readonly listeners = new Set<() => void>()
  private snapshot: readonly McpConnectionSnapshot[] = Object.freeze([])

  constructor(ctx: Context) {
    super(ctx, 'mcpRegistry')
    ctx.effect(() => () => {
      this.listeners.clear()
      this.records.clear()
      this.snapshot = Object.freeze([])
    }, 'mcpRegistry.observers')
  }

  /**
   * Read immutable rows, stable between changes.
   * @returns the current secret-free observations.
   */
  getSnapshot(): readonly McpConnectionSnapshot[] {
    return this.snapshot
  }

  /**
   * Observe row changes.
   * @param listener - callback without a payload.
   * @returns effect-scoped unsubscribe.
   */
  subscribe(listener: () => void): () => void {
    const dispose = this.ctx.effect(() => {
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    }, 'mcpRegistry.subscribe')
    return () => { void dispose() }
  }

  /**
   * Private launcher contribution shared across package entrypoints.
   * @param identity - immutable instance identity.
   * @param handle - connection whose changes update the row.
   * @returns contribution disposer.
   */
  [connectionContribution](identity: ConnectionIdentity, handle: ConnectionHandle): () => void {
    const update = (): void => {
      this.records.set(identity.id, Object.freeze({ ...identity, ...handle.getSnapshot() }))
      this.snapshot = Object.freeze([...this.records.values()])
      notifyObservers(this.ctx, this.listeners)
    }
    const unsubscribe = handle.subscribe(update)
    update()
    return () => {
      unsubscribe()
      this.records.delete(identity.id)
      this.snapshot = Object.freeze([...this.records.values()])
      notifyObservers(this.ctx, this.listeners)
    }
  }
}

export default McpRegistry
