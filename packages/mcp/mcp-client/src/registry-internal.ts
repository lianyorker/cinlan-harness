/** Launcher-owned registration protocol; registry consumers only read and subscribe. @module */
import type { Context } from '@deepseek-ai/cordis'
import type McpRegistry from './registry.ts'
import type { ConnectionHandle, McpConnectionSnapshot } from './types.ts'

/** Shared across the separately bundled main and registry entrypoints. */
export const connectionContribution = Symbol.for('dsh.mcp-client.registry.contribute')

/** Immutable identity supplied only by the connection launcher. */
export type ConnectionIdentity = Pick<McpConnectionSnapshot, 'id' | 'serverName' | 'transport' | 'owner'>

/**
 * Attach a launcher for the lifetime of its context.
 * @param ctx - context owning contribution removal.
 * @param registry - mounted read-only service.
 * @param identity - launcher identity without transport configuration.
 * @param handle - supervised connection to observe.
 */
export function contributeConnection(ctx: Context, registry: McpRegistry, identity: ConnectionIdentity, handle: ConnectionHandle): void {
  ctx.effect(() => registry[connectionContribution](identity, handle), 'mcpRegistry.connection')
}
