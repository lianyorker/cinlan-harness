/** A non-acknowledging external transport cannot authorize an overlapping managed connection. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as invariant from '../src/invariant.ts'
import { startHttpMcpFixture } from '../../mcp-client/tests/http-fixture.ts'
import { bootFixture } from './harness.ts'

describe('unconfirmed MCP transport shutdown', () => {
  it('admits a settled disabled record after unconfirmed shutdown withdraws its registration', async () => {
    const server = await startHttpMcpFixture()
    onTestFinished(async () => { await server.close() })
    const { ctx } = await bootFixture()
    const saved = await ctx.mcpManagement.save({ expectedRevision: 0, record: {
      transport: 'streamable-http', serverName: 'disabled_unclosed', enabled: true, url: server.url,
      headers: {}, reconnect: { enabled: false },
    } })
    await vi.waitFor(() => { expect(ctx.mcpManagement.getSnapshot().servers[0]?.observed.phase).toBe('ready') }, { timeout: 5_000 })
    await ctx.plugin(InvariantRegistry).await()
    await ctx.plugin(invariant).await()
    const dispatch = (): void => { ctx.events.dispatch('waterfall', ['tools/pre-execute']) }
    expect(dispatch).not.toThrow()
    expect(ctx.mcpRegistry.getSnapshot()).toHaveLength(1)
    const transports = new Set<Client>()
    const unavailableClose = vi.spyOn(Client.prototype, 'close').mockImplementation(function (this: Client) {
      transports.add(this)
      return Promise.resolve()
    })
    onTestFinished(async () => {
      unavailableClose.mockRestore()
      for (const transport of transports) await transport.close()
      await ctx.fiber.dispose()
    })
    await expect(ctx.mcpManagement.setEnabled({ id: saved.id, expectedRevision: 1, enabled: false }))
      .rejects.toMatchObject({ code: 'close-failed' })
    expect(ctx.mcpManagement.getSnapshot()).toMatchObject({ revision: 2, reconciling: false, servers: [{
      record: { id: saved.id, enabled: false },
      observed: { phase: 'stopped', errorCode: 'close-timeout', tools: [] }, applying: false,
    }] })
    expect(ctx.mcpRegistry.getSnapshot()).toEqual([])
    expect(ctx.tools.get('mcp__disabled_unclosed__ping')).toBeUndefined()
    expect(dispatch).not.toThrow()
  }, 15_000)

  it('retains the record and refuses remove or reconnect after a close timeout', async () => {
    const server = await startHttpMcpFixture()
    onTestFinished(async () => { await server.close() })
    const { ctx } = await bootFixture()
    const saved = await ctx.mcpManagement.save({ expectedRevision: 0, record: {
      transport: 'streamable-http', serverName: 'unclosed', enabled: true, url: server.url,
      headers: {}, reconnect: { enabled: false },
    } })
    await vi.waitFor(() => { expect(ctx.mcpManagement.getSnapshot().servers[0]?.observed.phase).toBe('ready') }, { timeout: 5_000 })
    const transports = new Set<Client>()
    const unavailableClose = vi.spyOn(Client.prototype, 'close').mockImplementation(function (this: Client) {
      transports.add(this)
      return Promise.resolve()
    })
    onTestFinished(async () => {
      unavailableClose.mockRestore()
      for (const transport of transports) await transport.close()
      await ctx.fiber.dispose()
    })
    await expect(ctx.mcpManagement.remove({ id: saved.id, expectedRevision: 1 })).rejects.toMatchObject({ code: 'close-failed' })
    expect(ctx.mcpManagement.getSnapshot()).toMatchObject({ revision: 1, servers: [{
      record: { id: saved.id }, observed: { errorCode: 'close-timeout' },
    }] })
    const calls = server.methods.filter(method => method === 'initialize').length
    await expect(ctx.mcpManagement.reconnect({ id: saved.id })).rejects.toMatchObject({ code: 'close-failed' })
    expect(server.methods.filter(method => method === 'initialize')).toHaveLength(calls)
    const { id: _id, ...desired } = ctx.mcpManagement.getSnapshot().servers[0]!.record
    await expect(ctx.mcpManagement.save({ id: saved.id, expectedRevision: 1, record: { ...desired, serverName: 'replacement' } }))
      .rejects.toMatchObject({ code: 'close-failed' })
    await expect(ctx.mcpManagement.setEnabled({ id: saved.id, expectedRevision: 1, enabled: true }))
      .rejects.toMatchObject({ code: 'close-failed' })
    await expect(ctx.mcpManagement.setEnabled({ id: saved.id, expectedRevision: 1, enabled: false }))
      .rejects.toMatchObject({ code: 'close-failed' })
    expect(ctx.mcpManagement.getSnapshot()).toMatchObject({ revision: 2, servers: [{
      record: { enabled: false }, observed: { errorCode: 'close-timeout' }, applying: false,
    }] })
    expect(server.methods.filter(method => method === 'initialize')).toHaveLength(calls)
  }, 15_000)
})
