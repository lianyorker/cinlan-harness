/** Real current-profile management, persistence, credentials and MCP bridge composition. */
import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import type { McpServerId } from '@deepseek-ai/dsh-mcp-client'
import { createScope } from '@deepseek-ai/dsh-scope'
import { startHttpMcpFixture } from '../../mcp-client/tests/http-fixture.ts'
import McpManagement, { type McpServerInput } from '../src/index.ts'
import { bootFixture, createFixtureDirectory } from './harness.ts'

const disabled: McpServerInput = {
  transport: 'stdio', serverName: 'fixture', enabled: false, command: process.execPath,
  args: [resolve(import.meta.dirname, '../../mcp-client/tests/fixture-server.ts')], cwd: '', env: {},
  reconnect: { enabled: false },
}
const snapshotRow = (manager: McpManagement, id: McpServerId) => manager.getSnapshot().servers.find(row => row.record.id === id)

async function httpServer(owner?: Context) {
  const server = await startHttpMcpFixture()
  onTestFinished(async () => { await owner?.fiber.dispose(); await server.close() })
  return server
}

describe('profile-owned MCP management through the Loader', () => {
  it('persists disabled configuration, fences revisions, and keeps profiles separate across restart', async () => {
    const directory = await createFixtureDirectory()
    const first = await bootFixture({ directory })
    const saved = await first.ctx.mcpManagement.save({ record: disabled, expectedRevision: 0 })
    expect(saved.snapshot.revision).toBe(1)
    expect(saved.snapshot.servers[0]?.observed.phase).toBe('stopped')
    expect(first.ctx.mcpRegistry.getSnapshot()).toEqual([])
    await expect(first.ctx.mcpManagement.remove({ id: saved.id, expectedRevision: 0 })).rejects.toMatchObject({ code: 'conflict' })
    await expect(first.ctx.mcpManagement.save({ record: disabled, expectedRevision: 1 })).rejects.toMatchObject({ code: 'invalid-config' })
    await first.ctx.fiber.dispose()
    const other = await bootFixture({ directory, profile: 'other-fixture' })
    expect(other.ctx.mcpManagement.getSnapshot().servers).toEqual([])
    await other.ctx.fiber.dispose()
    const reopened = await bootFixture({ directory })
    expect(reopened.ctx.mcpManagement.getSnapshot().servers.map(row => row.record.id)).toEqual([saved.id])
    expect(reopened.ctx.mcpManagement.getSnapshot().revision).toBe(1)
    await reopened.ctx.mcpManagement.remove({ id: saved.id, expectedRevision: 1 })
    expect(reopened.ctx.mcpManagement.getSnapshot()).toMatchObject({ revision: 2, servers: [] })
  })

  it('serializes two editors so only one writes a shared observed revision', async () => {
    const { ctx } = await bootFixture()
    const results = await Promise.allSettled([
      ctx.mcpManagement.save({ record: disabled, expectedRevision: 0 }),
      ctx.mcpManagement.save({ record: { ...disabled, serverName: 'second' }, expectedRevision: 0 }),
    ])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(ctx.mcpManagement.getSnapshot()).toMatchObject({ revision: 1, reconciling: false })
    expect(ctx.mcpManagement.getSnapshot().servers).toHaveLength(1)
  })

  it('saves missing credentials as an activation error, resolves a new credential on reconnect, and redacts tool metadata', async () => {
    const { ctx } = await bootFixture()
    const server = await httpServer(ctx)
    const ref = credentialRef('MCP_FIXTURE_MANAGED_TOKEN')
    const firstSecret = 'fixture-private-token-one'
    server.setAuthorization('Bearer ' + firstSecret)
    server.setTools([{ name: 'ping', description: 'Authenticated with ' + firstSecret }])
    const saved = await ctx.mcpManagement.save({ expectedRevision: 0, record: {
      transport: 'streamable-http', serverName: 'secured', enabled: true, url: server.url,
      headers: { Authorization: { ref, prefix: 'Bearer ' } }, reconnect: { enabled: false },
    } })
    expect(saved.snapshot.servers[0]?.record.enabled).toBe(true)
    await vi.waitFor(() => { expect(snapshotRow(ctx.mcpManagement, saved.id)?.observed.errorCode).toBe('missing-credential') }, { timeout: 5_000 })
    expect(server.authorization).toEqual([])
    await ctx.credentials.set(ref, firstSecret)
    await ctx.mcpManagement.reconnect({ id: saved.id })
    await vi.waitFor(() => { expect(snapshotRow(ctx.mcpManagement, saved.id)?.observed.phase).toBe('ready') }, { timeout: 5_000 })
    expect(snapshotRow(ctx.mcpManagement, saved.id)?.observed.tools[0]?.description).toContain('[redacted]')
    expect(JSON.stringify(ctx.mcpManagement.getSnapshot())).not.toContain(firstSecret)
    expect(server.authorization).toContain('Bearer ' + firstSecret)
    server.setTools([{ name: 'next', description: 'Updated tool metadata' }])
    const refreshed = await ctx.mcpManagement.probe({ id: saved.id }, new AbortController().signal)
    expect(refreshed.servers[0]?.observed.tools.map(tool => tool.name)).toEqual(['mcp__secured__next'])
    expect(server.methods).not.toContain('tools/call')
    const nextSecret = 'fixture-private-token-two'
    server.setAuthorization('Bearer ' + nextSecret)
    await ctx.credentials.set(ref, nextSecret)
    await ctx.mcpManagement.reconnect({ id: saved.id })
    await vi.waitFor(() => { expect(snapshotRow(ctx.mcpManagement, saved.id)?.observed.phase).toBe('ready') }, { timeout: 5_000 })
    expect(server.authorization).toContain('Bearer ' + nextSecret)
    expect(ctx.mcpManagement.getSnapshot().revision).toBe(1)
    await ctx.mcpManagement.setEnabled({ id: saved.id, enabled: false, expectedRevision: 1 })
    expect(ctx.mcpRegistry.getSnapshot()).toEqual([])
    expect(ctx.tools.schemas()).toEqual([])
    await expect(ctx.mcpManagement.probe({ id: saved.id }, new AbortController().signal)).rejects.toMatchObject({ code: 'disabled' })
  }, 15_000)

  it('resolves credentials again during supervised reconnect without changing the saved revision', async () => {
    const { ctx } = await bootFixture()
    const server = await httpServer(ctx)
    const ref = credentialRef('MCP_FIXTURE_RETRY_TOKEN')
    server.setAuthorization('Bearer fixture-retry-secret')
    const saved = await ctx.mcpManagement.save({ expectedRevision: 0, record: {
      transport: 'streamable-http', serverName: 'recovering', enabled: true, url: server.url,
      headers: { Authorization: { ref, prefix: 'Bearer ' } },
      reconnect: { enabled: true, initialDelayMs: 50, maxDelayMs: 100, maxAttempts: 20 },
    } })
    await vi.waitFor(() => { expect(snapshotRow(ctx.mcpManagement, saved.id)?.observed.phase).toBe('backoff') }, { timeout: 5_000 })
    await ctx.credentials.set(ref, 'fixture-retry-secret')
    await vi.waitFor(() => { expect(snapshotRow(ctx.mcpManagement, saved.id)?.observed.phase).toBe('ready') }, { timeout: 5_000 })
    expect(ctx.mcpManagement.getSnapshot().revision).toBe(1)
    expect(ctx.mcpRegistry.getSnapshot()).toHaveLength(1)
  }, 10_000)

  it('retains a rejected authenticated endpoint and reports an actual safe failure', async () => {
    const { ctx } = await bootFixture()
    const server = await httpServer(ctx)
    const ref = credentialRef('MCP_FIXTURE_REJECTED_TOKEN')
    await ctx.credentials.set(ref, 'fixture-wrong-credential')
    server.setAuthorization('Bearer fixture-expected-credential')
    const saved = await ctx.mcpManagement.save({ expectedRevision: 0, record: {
      transport: 'streamable-http', serverName: 'denied', enabled: true, url: server.url,
      headers: { Authorization: { ref, prefix: 'Bearer ' } }, reconnect: { enabled: false },
    } })
    await vi.waitFor(() => { expect(snapshotRow(ctx.mcpManagement, saved.id)?.observed.phase).toBe('error') }, { timeout: 5_000 })
    expect(snapshotRow(ctx.mcpManagement, saved.id)?.observed.errorCode).toBe('authentication-failed')
    expect(ctx.mcpManagement.getSnapshot().revision).toBe(1)
    expect(JSON.stringify(ctx.mcpManagement.getSnapshot())).not.toContain('fixture-wrong-credential')
  }, 10_000)

  it('owns stdio start, stop and HMR without leaking namespaces or tool registrations', async () => {
    const { ctx } = await bootFixture()
    const saved = await ctx.mcpManagement.save({ record: { ...disabled, enabled: true }, expectedRevision: 0 })
    await vi.waitFor(() => { expect(snapshotRow(ctx.mcpManagement, saved.id)?.observed.phase).toBe('ready') }, { timeout: 8_000 })
    expect(ctx.tools.schemas().some(tool => tool.name === 'mcp__fixture__greet')).toBe(true)
    const originalConnection = ctx.mcpRegistry.getSnapshot()[0]?.id
    await ctx.mcpManagement.reconnect({ id: saved.id })
    await vi.waitFor(() => { expect(snapshotRow(ctx.mcpManagement, saved.id)?.observed.phase).toBe('ready') }, { timeout: 8_000 })
    expect(ctx.mcpRegistry.getSnapshot()).toHaveLength(1)
    expect(ctx.mcpRegistry.getSnapshot()[0]?.id).not.toBe(originalConnection)
    const entry = ctx.loader.entries().find(item => item.options.id === 'manager')
    if (entry?.fiber === undefined) throw new Error('Fixture manager has no Loader fiber')
    await entry.fiber.update({ profile: 'fixture-profile' }, true)
    await entry.fiber.await()
    await vi.waitFor(() => { expect(snapshotRow(ctx.mcpManagement, saved.id)?.observed.phase).toBe('ready') }, { timeout: 8_000 })
    expect(ctx.mcpRegistry.getSnapshot()).toHaveLength(1)
    await ctx.mcpManagement.remove({ id: saved.id, expectedRevision: 1 })
    expect(ctx.mcpRegistry.getSnapshot()).toEqual([])
    expect(ctx.tools.schemas()).toEqual([])
  }, 30_000)

  it('observes externally composed root connections read-only and excludes actual Agent scopes', async () => {
    const server = await httpServer()
    const { ctx } = await bootFixture({
      patches: [{ insert: [{ id: 'external', name: 'cordis:mcp-fixture-external', config: {
        transport: 'streamable-http', serverName: 'composed', url: server.url, reconnect: { enabled: false },
      } }] }],
      prepare: (root) => { root.loader.builtins['mcp-fixture-external'] = McpClient },
    })
    const external = ctx.mcpManagement.getSnapshot().external[0]
    expect(external?.owner).toMatchObject({ kind: 'composition', label: 'include:external' })
    const before = ctx.loader.entries().find(entry => entry.options.id === 'external')?.options
    const agent = createScope(ctx, {})
    const fiber = agent.ctx.plugin(McpClient, { transport: 'streamable-http', serverName: 'agent_only', url: server.url })
    await fiber.await()
    expect(ctx.mcpManagement.getSnapshot().external.map(row => row.serverName)).toEqual(['composed'])
    const saved = await ctx.mcpManagement.save({ record: { ...disabled, enabled: true, serverName: 'composed' }, expectedRevision: 0 })
    await vi.waitFor(() => { expect(snapshotRow(ctx.mcpManagement, saved.id)?.observed.phase).toBe('error') }, { timeout: 5_000 })
    await ctx.mcpManagement.remove({ id: saved.id, expectedRevision: 1 })
    expect(ctx.mcpManagement.getSnapshot().external).toHaveLength(1)
    expect(ctx.loader.entries().find(entry => entry.options.id === 'external')?.options).toEqual(before)
    await agent.dispose()
  }, 15_000)
})
