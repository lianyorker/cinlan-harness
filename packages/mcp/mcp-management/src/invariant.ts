/** Settled desired records agree with manager-owned root connection registrations. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from './index.ts'
import type {} from '@deepseek-ai/dsh-mcp-client/registry'

/** Companion plugin name. */
export const name = 'mcp-management-invariant'
/** Reserve invariant ownership before installing its service-dependent checks. */
export const inject = ['invariants']

const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const check = (): void => {
    const snapshot = ctx.mcpManagement.getSnapshot()
    if (snapshot.reconciling) return
    const managed = ctx.mcpRegistry.getSnapshot().filter(connection => connection.owner.kind === 'managed')
    for (const row of snapshot.servers) {
      if (row.applying) continue
      const registrations = managed.filter(connection => connection.owner.kind === 'managed' && connection.owner.recordId === row.record.id)
      if (!row.record.enabled && registrations.length !== 0) fail('Disabled MCP record retains an owned connection')
      if (row.record.enabled && row.observed.phase !== 'error' && row.observed.errorCode !== 'close-timeout'
        && registrations.length !== 1) {
        fail('Enabled MCP record lacks exactly one owned connection')
      }
      if (registrations.some(connection => connection.serverName !== row.record.serverName)) {
        fail('Owned MCP namespace differs from its committed desired record')
      }
    }
    for (const connection of managed) {
      const owner = connection.owner
      if (owner.kind === 'managed' && !snapshot.servers.some(row => row.record.id === owner.recordId)) {
        fail('Managed MCP connection has no committed desired record')
      }
    }
  }
  check()
  ctx.on('internal/dispatch', (_mode, event) => {
    if (event === 'tools/pre-execute') check()
  }, { global: true })
}, { inject: ['mcpManagement', 'mcpRegistry'] })

/** @param ctx - Invariant registry. @returns Disposal of the installed desired-state relationship check. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-mcp-management', install))
