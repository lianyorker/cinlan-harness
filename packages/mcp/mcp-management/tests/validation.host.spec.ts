/** Validate model/Remote and persisted MCP definitions at their actual parser boundaries. */
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { McpServerId } from '@deepseek-ai/dsh-mcp-client'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { McpServerInput } from '../src/types.ts'
import { serverInputSchema } from '../src/schema.ts'
import { bootFixture, createFixtureDirectory } from './harness.ts'

const stdio: McpServerInput = {
  transport: 'stdio', serverName: 'stored', enabled: false, command: process.execPath, args: [], cwd: '', env: {},
}
const http = {
  transport: 'streamable-http', serverName: 'parsed', enabled: false, url: 'https://fixture.invalid/mcp', headers: {},
}

describe('MCP configuration admission', () => {
  it.each([
    'not a URL', 'file:///tmp/server', 'https://user:secret@fixture.invalid/mcp',
    'https://user@fixture.invalid/mcp', 'https://fixture.invalid/mcp?token=secret', 'https://fixture.invalid/mcp#secret',
  ])('refuses credential-bearing or unsupported endpoint %s', (url) => {
    expect(serverInputSchema.safeParse({ ...http, url }).success).toBe(false)
  })

  it.each([
    { Authorization: { ref: 'valid_ref', prefix: 'Bearer\r\nInjected: value' } },
    { Authorization: { ref: 'raw-secret-with-hyphen', prefix: '' } },
    { 'Header:injected': { ref: 'valid_ref', prefix: '' } },
  ])('refuses malformed header bindings at the input parser', (headers) => {
    expect(serverInputSchema.safeParse({ ...http, headers }).success).toBe(false)
  })

  it('accepts safe HTTP and HTTPS endpoints and preserves explicit optional timing', async () => {
    expect(serverInputSchema.safeParse({ ...http, url: 'http://127.0.0.1/mcp' }).success).toBe(true)
    const { ctx } = await bootFixture()
    const saved = await ctx.mcpManagement.save({ expectedRevision: 0, record: {
      ...stdio, toolCallTimeoutMs: MAX_TIMER_DELAY_MS, reconnect: {},
    } })
    expect(saved.snapshot.servers[0]?.record).toMatchObject({ toolCallTimeoutMs: MAX_TIMER_DELAY_MS, reconnect: {} })
    const second = await ctx.mcpManagement.save({ expectedRevision: 1, record: { ...stdio, serverName: 'defaulted' } })
    expect(second.snapshot.servers[1]?.record).not.toHaveProperty('reconnect')
    expect(second.snapshot.servers[1]?.record).not.toHaveProperty('toolCallTimeoutMs')
  })

  it('rejects invalid timer values and contradictory backoff limits before persistence', async () => {
    const { ctx } = await bootFixture()
    for (const toolCallTimeoutMs of [0, 1.5, MAX_TIMER_DELAY_MS + 1]) {
      await expect(ctx.mcpManagement.save({ expectedRevision: 0, record: { ...stdio, toolCallTimeoutMs } }))
        .rejects.toMatchObject({ code: 'invalid-config' })
    }
    await expect(ctx.mcpManagement.save({ expectedRevision: 0, record: {
      ...stdio, reconnect: { initialDelayMs: 100, maxDelayMs: 10 },
    } })).rejects.toMatchObject({ code: 'invalid-config' })
    expect(ctx.mcpManagement.getSnapshot()).toMatchObject({ revision: 0, servers: [] })
  })

  it('refuses a revision overflow without overwriting the durable profile', async () => {
    const { ctx } = await bootFixture()
    const table = ctx.storageDomain.get('mcp_management')!.table('profiles')
    await table.put('fixture-profile', { revision: Number.MAX_SAFE_INTEGER, records: [] })
    await expect(ctx.mcpManagement.save({ expectedRevision: Number.MAX_SAFE_INTEGER, record: stdio }))
      .rejects.toMatchObject({ code: 'storage-failed' })
    expect(table.get('fixture-profile')).toEqual({ revision: Number.MAX_SAFE_INTEGER, records: [] })
  })

  it('refuses semantically invalid persisted timing before starting any child', async () => {
    const directory = await createFixtureDirectory()
    const first = await bootFixture({ directory })
    await first.ctx.storageDomain.get('mcp_management')!.table('profiles').put('fixture-profile', {
      revision: 1,
      records: [{ ...stdio, id: brandString<McpServerId>(randomUUID()), reconnect: { initialDelayMs: 100, maxDelayMs: 10 } }],
    })
    await first.ctx.fiber.dispose()
    await expect(bootFixture({ directory })).rejects.toThrow('invalid-config')
  })

  it.each(['identity', 'namespace'])('refuses a persisted duplicate %s before activation', async (collision) => {
    const directory = await createFixtureDirectory()
    const first = await bootFixture({ directory })
    const id = randomUUID()
    await first.ctx.storageDomain.get('mcp_management')!.table('profiles').put('fixture-profile', {
      revision: 1,
      records: [
        { ...stdio, id },
        { ...stdio, id: collision === 'identity' ? id : randomUUID(), serverName: collision === 'namespace' ? 'stored' : 'second' },
      ],
    })
    await first.ctx.fiber.dispose()
    await expect(bootFixture({ directory })).rejects.toThrow('Invalid input')
  })
})
