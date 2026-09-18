/** Real manager edits, storage failures, tool discovery and shutdown races. */
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { Context } from '@deepseek-ai/cordis'
import type { McpServerId } from '@deepseek-ai/dsh-mcp-client'
import type { McpHttpServer, McpServerInput } from '../src/types.ts'
import { bootFixture } from './harness.ts'
import { startControlledHttpFixture } from './controlled-http.ts'

const disabled: McpServerInput = {
  transport: 'stdio', serverName: 'fixture', enabled: false, command: process.execPath,
  args: [], cwd: '', env: {},
}
const row = (ctx: Context, id: McpServerId) => ctx.mcpManagement.getSnapshot().servers.find(item => item.record.id === id)
async function endpoint(ctx: Context) {
  const server = await startControlledHttpFixture()
  onTestFinished(async () => { await ctx.fiber.dispose(); await server.close() })
  return server
}
const httpRecord = (url: string, serverName = 'fixture'): McpHttpServer => ({
  transport: 'streamable-http', serverName, enabled: true, url, headers: {}, reconnect: { enabled: false },
})

describe('managed MCP lifecycle transitions', () => {
  it('updates an existing namespace and re-enables a saved disabled definition', async () => {
    const { ctx } = await bootFixture()
    const server = await endpoint(ctx)
    const saved = await ctx.mcpManagement.save({ expectedRevision: 0, record: { ...httpRecord(server.url), enabled: false } })
    await expect(ctx.mcpManagement.reconnect({ id: saved.id })).rejects.toMatchObject({ code: 'disabled' })
    await ctx.mcpManagement.setEnabled({ id: saved.id, expectedRevision: 1, enabled: true })
    await vi.waitFor(() => { expect(row(ctx, saved.id)?.observed.phase).toBe('ready') }, { timeout: 5_000 })
    const oldConnection = ctx.mcpRegistry.getSnapshot()[0]?.id
    const second = await ctx.mcpManagement.save({ expectedRevision: 2, record: { ...disabled, serverName: 'untouched' } })
    await ctx.mcpManagement.save({ id: saved.id, expectedRevision: 3, record: {
      ...httpRecord(server.url, 'renamed'), toolCallTimeoutMs: 5_000, reconnect: { enabled: false, maxAttempts: 2 },
    } })
    await vi.waitFor(() => { expect(row(ctx, saved.id)?.observed.phase).toBe('ready') }, { timeout: 5_000 })
    expect(ctx.tools.get('mcp__fixture__ping')).toBeUndefined()
    expect(ctx.tools.get('mcp__renamed__ping')).toBeDefined()
    expect(ctx.mcpRegistry.getSnapshot()[0]?.id).not.toBe(oldConnection)
    expect(row(ctx, second.id)?.record.serverName).toBe('untouched')
    expect(ctx.mcpManagement.getSnapshot().revision).toBe(4)
    await ctx.mcpManagement.setEnabled({ id: saved.id, expectedRevision: 4, enabled: false })
    await ctx.mcpManagement.setEnabled({ id: saved.id, expectedRevision: 5, enabled: true })
    await vi.waitFor(() => { expect(row(ctx, saved.id)?.observed.phase).toBe('ready') }, { timeout: 5_000 })
  }, 15_000)

  it('refuses unknown identities without disturbing committed records', async () => {
    const { ctx } = await bootFixture()
    const id = brandString<McpServerId>(randomUUID())
    const manager = ctx.mcpManagement
    await expect(manager.save({ id, expectedRevision: 0, record: disabled })).rejects.toMatchObject({ code: 'not-found' })
    await expect(manager.remove({ id, expectedRevision: 0 })).rejects.toMatchObject({ code: 'not-found' })
    await expect(manager.setEnabled({ id, expectedRevision: 0, enabled: true })).rejects.toMatchObject({ code: 'not-found' })
    await expect(manager.reconnect({ id })).rejects.toMatchObject({ code: 'not-found' })
    await expect(manager.probe({ id }, new AbortController().signal)).rejects.toMatchObject({ code: 'not-found' })
    expect(manager.getSnapshot()).toMatchObject({ revision: 0, servers: [], reconciling: false })
  })

  it('passes only a credential reference into storage and its resolved value into the stdio environment', async () => {
    const { ctx, directory } = await bootFixture()
    const ref = credentialRef('MCP_STDIO_' + randomUUID().replaceAll('-', '_'))
    const secret = 'stdio-fixture-private-credential'
    await ctx.credentials.set(ref, secret)
    const saved = await ctx.mcpManagement.save({ expectedRevision: 0, record: {
      ...disabled, enabled: true, serverName: 'environment',
      args: [resolve(import.meta.dirname, 'fixtures/env-server.ts')],
      env: { MCP_MANAGEMENT_FIXTURE_VALUE: ref }, toolCallTimeoutMs: 5_000,
      reconnect: { initialDelayMs: 10, maxDelayMs: 20, maxAttempts: 1, enabled: false },
    } })
    await vi.waitFor(() => { expect(row(ctx, saved.id)?.observed.phase).toBe('ready') }, { timeout: 8_000 })
    expect(row(ctx, saved.id)?.observed.tools[0]?.description).toBe('Child received [redacted]')
    const durable = await readFile(join(directory, 'storage/mcp_management/profiles/fixture-profile.json'), 'utf8')
    expect(durable).toContain(ref)
    expect(durable).not.toContain(secret)
    expect(JSON.stringify(ctx.mcpManagement.getSnapshot())).not.toContain(secret)
  }, 15_000)

  it('contains a failed observer while later subscribers receive committed state', async () => {
    const { ctx } = await bootFixture()
    const manager = ctx.mcpManagement
    const messages: number[] = []
    const removeBroken = manager.subscribe(() => { throw new Error('fixture observer failure') })
    const removeHealthy = manager.subscribe(() => { messages.push(manager.getSnapshot().revision) })
    await manager.save({ expectedRevision: 0, record: disabled })
    expect(messages).toContain(1)
    removeBroken()
    removeHealthy()
    const observed = [...messages]
    await manager.save({ expectedRevision: 1, record: { ...disabled, serverName: 'second' } })
    expect(messages).toEqual(observed)
    expect(manager.getSnapshot().revision).toBe(2)
  })

  it('preserves tool registrations on cancellation and upstream tools/list failure', async () => {
    const { ctx } = await bootFixture()
    const server = await endpoint(ctx)
    const startup = server.holdList()
    onTestFinished(startup.release)
    const saved = await ctx.mcpManagement.save({ expectedRevision: 0, record: httpRecord(server.url) })
    await startup.requested
    await expect(ctx.mcpManagement.probe({ id: saved.id }, new AbortController().signal)).rejects.toMatchObject({ code: 'not-ready' })
    startup.release()
    await vi.waitFor(() => { expect(row(ctx, saved.id)?.observed.phase).toBe('ready') }, { timeout: 5_000 })
    const signal = new AbortController()
    const held = server.holdList()
    onTestFinished(held.release)
    server.setTool('replacement')
    const probing = ctx.mcpManagement.probe({ id: saved.id }, signal.signal)
    const cancelled = expect(probing).rejects.toMatchObject({ name: 'AbortError' })
    await held.requested
    signal.abort()
    await cancelled
    held.release()
    expect(row(ctx, saved.id)?.observed.tools.map(tool => tool.name)).toEqual(['mcp__fixture__ping'])
    server.failLists(true)
    await expect(ctx.mcpManagement.probe({ id: saved.id }, new AbortController().signal)).rejects.toMatchObject({ code: 'probe-failed' })
    expect(JSON.stringify(ctx.mcpManagement.getSnapshot())).not.toContain('should-never-leak')
    expect(ctx.tools.get('mcp__fixture__ping')).toBeDefined()
    server.failLists(false)
    await ctx.mcpManagement.probe({ id: saved.id }, new AbortController().signal)
    expect(row(ctx, saved.id)?.observed.tools.map(tool => tool.name)).toEqual(['mcp__fixture__replacement'])
    expect(server.methods).not.toContain('tools/call')
  }, 15_000)

  it('restores the previously enabled child when durable removal fails', async () => {
    const { ctx, directory } = await bootFixture()
    const server = await endpoint(ctx)
    const saved = await ctx.mcpManagement.save({ expectedRevision: 0, record: httpRecord(server.url) })
    await vi.waitFor(() => { expect(row(ctx, saved.id)?.observed.phase).toBe('ready') }, { timeout: 5_000 })
    const oldConnection = ctx.mcpRegistry.getSnapshot()[0]?.id
    const path = join(directory, 'storage/mcp_management/profiles/fixture-profile.json')
    const backup = path + '.test-backup'
    await rename(path, backup)
    await mkdir(path)
    try {
      await expect(ctx.mcpManagement.remove({ id: saved.id, expectedRevision: 1 })).rejects.toMatchObject({ code: 'storage-failed' })
      await vi.waitFor(() => { expect(row(ctx, saved.id)?.observed.phase).toBe('ready') }, { timeout: 5_000 })
      expect(ctx.mcpManagement.getSnapshot()).toMatchObject({ revision: 1, servers: [{ record: { id: saved.id, enabled: true } }] })
      expect(ctx.mcpRegistry.getSnapshot()[0]?.id).not.toBe(oldConnection)
      expect(ctx.tools.get('mcp__fixture__ping')).toBeDefined()
    } finally {
      await rm(path, { recursive: true })
      await rename(backup, path)
    }
    await ctx.fiber.dispose()
    const restarted = await bootFixture({ directory })
    await vi.waitFor(() => { expect(row(restarted.ctx, saved.id)?.observed.phase).toBe('ready') }, { timeout: 5_000 })
    expect(restarted.ctx.mcpManagement.getSnapshot().revision).toBe(1)
    await restarted.ctx.fiber.dispose()
  }, 15_000)

  it('stops a reconnect already replacing its child when manager shutdown begins', async () => {
    const { ctx } = await bootFixture()
    const server = await endpoint(ctx)
    const manager = ctx.mcpManagement
    const saved = await manager.save({ expectedRevision: 0, record: {
      transport: 'streamable-http', serverName: 'default_policy', enabled: true, url: server.url, headers: {},
    } })
    await vi.waitFor(() => { expect(row(ctx, saved.id)?.observed.phase).toBe('ready') }, { timeout: 5_000 })
    const fiber = ctx.loader.entries().find(entry => entry.options.id === 'manager')!.fiber!
    const shutdown: PromiseWithResolvers<void> = Promise.withResolvers()
    const unsubscribe = ctx.mcpRegistry.subscribe(() => {
      if (ctx.mcpRegistry.getSnapshot().length !== 0) return
      unsubscribe()
      void fiber.dispose().then(shutdown.resolve, shutdown.reject)
    })
    await manager.reconnect({ id: saved.id })
    await shutdown.promise
    while (fiber.inertia !== undefined) await fiber.inertia
    expect(server.methods.filter(method => method === 'initialize')).toHaveLength(1)
    expect(ctx.mcpRegistry.getSnapshot()).toEqual([])
    expect(manager.getSnapshot()).toMatchObject({ revision: 1, reconciling: false, servers: [{
      record: { id: saved.id, enabled: true }, observed: { phase: 'stopped' },
    }] })
  }, 15_000)

  it('settles queued edits before shutdown and refuses later operations', async () => {
    const { ctx, directory } = await bootFixture()
    const manager = ctx.mcpManagement
    const first = manager.save({ record: disabled, expectedRevision: 0 })
    const second = manager.save({ record: { ...disabled, serverName: 'second' }, expectedRevision: 1 })
    const settled = Promise.allSettled([first, second])
    const fiber = ctx.loader.entries().find(entry => entry.options.id === 'manager')!.fiber!
    await fiber.dispose()
    while (fiber.inertia !== undefined) await fiber.inertia
    const committed: McpServerId[] = []
    for (const result of await settled) {
      if (result.status === 'fulfilled') committed.push(result.value.id)
      else expect(result.reason).toMatchObject({ code: 'stopped' })
    }
    const id = brandString<McpServerId>(randomUUID())
    await expect(manager.save({ record: disabled, expectedRevision: 0 })).rejects.toMatchObject({ code: 'stopped' })
    await expect(manager.probe({ id }, new AbortController().signal)).rejects.toMatchObject({ code: 'stopped' })
    expect(manager.getSnapshot()).toMatchObject({ revision: committed.length, reconciling: false })
    await ctx.fiber.dispose()
    const reopened = await bootFixture({ directory })
    expect(reopened.ctx.mcpManagement.getSnapshot().servers.map(item => item.record.id)).toEqual(committed)
  })
})
