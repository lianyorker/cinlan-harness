/** The desired-record invariant rejects real owned connections without committed records. */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { Config, launchMcpClient, type McpServerId } from '@deepseek-ai/dsh-mcp-client'
import { startHttpMcpFixture } from '../../mcp-client/tests/http-fixture.ts'
import * as invariant from '../src/invariant.ts'
import { bootFixture } from './harness.ts'
import type { McpHttpServer } from '../src/types.ts'

const record = (url: string): McpHttpServer => ({
  transport: 'streamable-http', serverName: 'owned', enabled: true, url, headers: {}, reconnect: { enabled: false },
})
async function install(ctx: Context) {
  await ctx.plugin(InvariantRegistry).await()
  const companion = ctx.plugin(invariant)
  await companion.await()
  return () => { ctx.events.dispatch('waterfall', ['tools/pre-execute']) }
}
async function register(ctx: Context, url: string, serverName: string, id?: McpServerId) {
  const child = ctx.plugin({
    name: 'fixture-owned-connection', inject: ['tools'],
    async apply(owner: Context) {
      const handle = launchMcpClient(owner, Config({ transport: 'streamable-http', serverName, url, reconnect: { enabled: false } }),
        id === undefined ? {} : { owner: { kind: 'managed', recordId: id } })
      await handle.ready
    },
  })
  await child.await()
  return child
}
async function http(ctx: Context) {
  const server = await startHttpMcpFixture()
  onTestFinished(async () => { await ctx.fiber.dispose(); await server.close() })
  return server
}

describe('MCP desired-record invariant', () => {
  it('rejects a real connection belonging to a disabled desired record', async () => {
    const { ctx } = await bootFixture()
    const server = await http(ctx)
    const saved = await ctx.mcpManagement.save({ expectedRevision: 0, record: { ...record(server.url), enabled: false } })
    const dispatch = await install(ctx)
    expect(dispatch).not.toThrow()
    const child = await register(ctx, server.url, 'owned', saved.id)
    expect(dispatch).toThrow('Disabled MCP record retains an owned connection')
    await child.dispose()
    expect(dispatch).not.toThrow()
  }, 15_000)

  it('detects missing and mismatched registrations after an actual child unload', async () => {
    const { ctx } = await bootFixture()
    const server = await http(ctx)
    const saved = await ctx.mcpManagement.save({ expectedRevision: 0, record: record(server.url) })
    await vi.waitFor(() => { expect(ctx.mcpManagement.getSnapshot().servers[0]?.observed.phase).toBe('ready') }, { timeout: 5_000 })
    const dispatch = await install(ctx)
    expect(dispatch).not.toThrow()
    const runtime = [...ctx.registry.values()].find(item => item.name === 'mcp-managed-server')!
    const [owned] = runtime.fibers
    await owned!.dispose()
    expect(dispatch).toThrow('Enabled MCP record lacks exactly one owned connection')
    const wrong = await register(ctx, server.url, 'wrong_namespace', saved.id)
    expect(dispatch).toThrow('Owned MCP namespace differs from its committed desired record')
    await wrong.dispose()
    await ctx.mcpManagement.setEnabled({ id: saved.id, expectedRevision: 1, enabled: false })
    expect(dispatch).not.toThrow()
  }, 15_000)

  it('defers checks while desired state is being reconciled and admits composition-owned peers', async () => {
    const { ctx } = await bootFixture()
    const server = await http(ctx)
    const dispatch = await install(ctx)
    const saving = ctx.mcpManagement.save({ expectedRevision: 0, record: record(server.url) })
    expect(ctx.mcpManagement.getSnapshot().reconciling).toBe(true)
    expect(dispatch).not.toThrow()
    const saved = await saving
    await vi.waitFor(() => { expect(ctx.mcpManagement.getSnapshot().servers[0]?.observed.phase).toBe('ready') }, { timeout: 5_000 })
    const desired = { ...ctx.mcpManagement.getSnapshot().servers[0]!.record, serverName: 'updated' }
    await ctx.storageDomain.get('mcp_management')!.table('profiles').put('fixture-profile', { revision: 2, records: [desired] })
    const external = await register(ctx, server.url, 'composition_peer')
    expect(ctx.mcpManagement.getSnapshot().servers[0]?.applying).toBe(true)
    expect(dispatch).not.toThrow()
    await ctx.mcpManagement.setEnabled({ id: saved.id, expectedRevision: 2, enabled: true })
    await vi.waitFor(() => { expect(ctx.mcpManagement.getSnapshot().servers[0]?.observed.phase).toBe('ready') }, { timeout: 5_000 })
    expect(dispatch).not.toThrow()
    expect(ctx.tools.get('mcp__owned__ping')).toBeUndefined()
    expect(ctx.tools.get('mcp__updated__ping')).toBeDefined()
    await external.dispose()
  }, 15_000)

  it('permits an enabled definition whose external namespace is already owned', async () => {
    const { ctx } = await bootFixture()
    const server = await http(ctx)
    const external = await register(ctx, server.url, 'owned')
    const saved = await ctx.mcpManagement.save({ expectedRevision: 0, record: record(server.url) })
    await vi.waitFor(() => { expect(ctx.mcpManagement.getSnapshot().servers[0]?.observed.errorCode).toBe('namespace-conflict') }, { timeout: 5_000 })
    const dispatch = await install(ctx)
    expect(dispatch).not.toThrow()
    await ctx.mcpManagement.remove({ id: saved.id, expectedRevision: 1 })
    expect(ctx.mcpManagement.getSnapshot().external).toHaveLength(1)
    await external.dispose()
  }, 15_000)

  it('detects an orphan real connection and removes its check with the companion', async () => {
    const server = await startHttpMcpFixture()
    onTestFinished(async () => { await server.close() })
    const { ctx } = await bootFixture()
    await ctx.plugin(InvariantRegistry).await()
    const companion = ctx.plugin(invariant)
    await companion.await()
    const child = ctx.plugin({
      name: 'orphan-fixture', inject: ['tools'],
      async apply(owner: Context) {
        const handle = launchMcpClient(owner, Config({
          transport: 'streamable-http', serverName: 'orphan', url: server.url, reconnect: { enabled: false },
        }), { owner: { kind: 'managed', recordId: brandString<McpServerId>('orphan-fixture') } })
        await handle.ready
      },
    })
    await child.await()
    const dispatch = (): void => { ctx.events.dispatch('waterfall', ['tools/pre-execute']) }
    expect(dispatch).toThrow('Managed MCP connection has no committed desired record')
    await companion.dispose()
    expect(dispatch).not.toThrow()
    await child.dispose()
    expect(ctx.mcpRegistry.getSnapshot()).toEqual([])
  }, 15_000)
})
