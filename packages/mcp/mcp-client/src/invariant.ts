/** MCP discovery observations agree with live root tool registrations. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from './registry.ts'
import type {} from '@deepseek-ai/dsh-tools'

/** Cordis companion name. */
export const name = 'mcp-client-invariant'
/** Service required to reserve package invariant ownership. */
export const inject = ['invariants']

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const check = (): void => {
    for (const connection of ctx.mcpRegistry.getSnapshot()) {
      for (const tool of connection.tools) {
        if (ctx.tools.get(tool.name) === undefined) {
          fail('MCP discovery lists a tool absent from the root registry: ' + tool.name)
        }
      }
    }
  }
  check()
  // Tool swaps are synchronous; dispatch observes only committed generations.
  ctx.on('internal/dispatch', (_mode, event) => {
    if (event === 'tools/pre-execute') check()
  }, { global: true })
}, { inject: ['mcpRegistry', 'tools'] })

/**
 * Register the MCP snapshot-to-tool observation check.
 * @param ctx - context providing the invariant service.
 * @returns effect disposer after installation settles.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-mcp-client', install))
