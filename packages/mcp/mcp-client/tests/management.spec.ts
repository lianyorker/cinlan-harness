/** Real Loader compositions exercise lifecycle observations over owned MCP transports. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { boot } from '@deepseek-ai/dsh-app-boot'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as McpInvariant from '../src/invariant.ts'
import { createScope } from '@deepseek-ai/dsh-scope'
import * as McpClient from '../src/index.ts'
import McpRegistry from '../src/registry.ts'
import type { Config, ConnectionHandle, McpServerId, McpLaunchOptions } from '../src/index.ts'
import { startHttpMcpFixture } from './http-fixture.ts'

const stdioServer = fileURLToPath(new URL('./fixture-server.ts', import.meta.url))
const contexts: Context[] = []
const temporary: string[] = []
const endpoints: Awaited<ReturnType<typeof startHttpMcpFixture>>[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(endpoints.splice(0).map(endpoint => endpoint.close()))
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function compose(config: Config, options?: McpLaunchOptions): Promise<{ ctx: Context; handle: ConnectionHandle | undefined }> {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-management-'))
  temporary.push(directory)
  const path = join(directory, 'cordis.yml')
  await writeFile(path, await readFile(new URL('./fixtures/management.cordis.yml', import.meta.url)))
  let handle: ConnectionHandle | undefined
  const ctx = await boot('mcp-management-test', path,
    [{ insert: [{ id: 'external-server', name: 'cordis:test-mcp', config }] }],
    (context) => {
      contexts.push(context)
      context.loader.builtins['test-system-prompt'] = SystemPrompt
      context.loader.builtins['test-tools'] = ToolRuntime
      context.loader.builtins['test-mcp-registry'] = McpRegistry
      context.loader.builtins['test-mcp'] = options === undefined ? McpClient : {
        name: 'managed-fixture', inject: ['tools'],
        async apply(child: Context) {
          handle = McpClient.launchMcpClient(child, config, options)
          await handle.ready
        },
      }
    },
  )
  return { ctx, handle }
}

function managed(): McpLaunchOptions {
  return { owner: { kind: 'managed', recordId: brandString<McpServerId>('fixture-record') } }
}

async function httpFixture() {
  const endpoint = await startHttpMcpFixture()
  endpoints.push(endpoint)
  return endpoint
}

function httpConfig(url: string): Config {
  return McpClient.Config({ transport: 'streamable-http', serverName: 'http', url, reconnect: { enabled: false } })
}

describe('MCP management observations through Loader', () => {
  it('labels the actual composition entry and removes registrations on unload', async () => {
    const config = McpClient.Config({ transport: 'stdio', serverName: 'stdio', command: process.execPath, args: [stdioServer], reconnect: { enabled: false } })
    const { ctx } = await compose(config)
    const snapshot = ctx.mcpRegistry.getSnapshot()
    expect(ctx.mcpRegistry.getSnapshot()).toBe(snapshot)
    const row = snapshot[0]!
    expect(row).toMatchObject({ phase: 'ready', serverName: 'stdio', owner: { kind: 'composition', label: 'include:external-server' } })
    expect(row.tools.some(tool => tool.name === 'mcp__stdio__add')).toBe(true)
    expect(JSON.stringify(row)).not.toContain(process.execPath)
    const entry = ctx.loader.resolve('include:external-server')
    await entry.update({ config: { ...config, serverName: 'reloaded' } })
    expect(ctx.mcpRegistry.getSnapshot()).toHaveLength(1)
    expect(ctx.mcpRegistry.getSnapshot()[0]!.id).not.toBe(row.id)
    expect(ctx.mcpRegistry.getSnapshot()[0]).toMatchObject({ phase: 'ready', serverName: 'reloaded', owner: row.owner })
    expect(ctx.tools.get('mcp__stdio__add')).toBeUndefined()
    await entry.fiber!.dispose()
    expect(ctx.mcpRegistry.getSnapshot()).toEqual([])
    expect(ctx.tools.schemas().some(tool => tool.name.startsWith('mcp__stdio__'))).toBe(false)
  })

  it('redacts descriptors, observes HTTP auth failure and recovers by discovery only', async () => {
    const endpoint = await httpFixture()
    const token = 'fixture-secret-a9c711'
    endpoint.setAuthorization('Bearer ' + token)
    endpoint.setTools([{ name: 'ping', description: 'Echoed credential ' + token }])
    const config = httpConfig(endpoint.url)
    const { ctx, handle } = await compose(config, {
      ...managed(),
      resolveConfig: async () => ({ ...config, headers: { Authorization: 'Bearer ' + token } }),
      redact: text => text.replaceAll(token, '[redacted]'),
    })
    expect(handle!.getSnapshot().phase).toBe('ready')
    expect(ctx.mcpRegistry.getSnapshot()[0]!.owner).toEqual(managed().owner)
    expect(JSON.stringify(ctx.mcpRegistry.getSnapshot())).not.toContain(token)
    const first = ctx.mcpRegistry.getSnapshot()[0]!
    expect(Object.isFrozen(first.tools[0]!.inputSchema)).toBe(true)
    endpoint.setAuthorization('different-token')
    await expect(handle!.probe(new AbortController().signal)).rejects.toMatchObject({ code: 'authentication-failed' })
    expect(handle!.getSnapshot()).toMatchObject({ phase: 'error', errorCode: 'authentication-failed' })
    endpoint.setAuthorization('Bearer ' + token)
    endpoint.setTools([{ name: 'next', description: 'New tool' }])
    await expect(handle!.probe(new AbortController().signal)).resolves.toMatchObject([{ name: 'mcp__http__next' }])
    expect(handle!.getSnapshot().phase).toBe('ready')
    expect(ctx.tools.get('mcp__http__ping')).toBeUndefined()
    expect(endpoint.methods).not.toContain('tools/call')
    endpoint.setTools([{ name: token, description: 'Credential echoed as a tool name' }])
    await expect(handle!.probe(new AbortController().signal)).rejects.toMatchObject({ code: 'tool-sync-failed' })
    expect(handle!.getSnapshot()).toMatchObject({ phase: 'error', errorCode: 'tool-sync-failed' })
    expect(ctx.tools.get('mcp__http__next')).toBeDefined()
    expect(JSON.stringify(ctx.mcpRegistry.getSnapshot())).not.toContain(token)
    await handle!.dispose()
    expect(handle!.getSnapshot()).toMatchObject({ phase: 'stopped', tools: [] })
    await expect(handle!.probe(new AbortController().signal)).rejects.toMatchObject({ code: 'connection-failed' })
  })

  it('allows zero discovered tools and excludes Agent-scoped children from the root catalog', async () => {
    const endpoint = await httpFixture()
    endpoint.setTools([])
    const { ctx, handle } = await compose(httpConfig(endpoint.url), managed())
    expect(handle!.getSnapshot()).toMatchObject({ phase: 'ready', tools: [] })
    const scope = createScope(ctx, {})
    const child = McpClient.launchMcpClient(scope.ctx, httpConfig(endpoint.url), managed())
    await child.ready
    expect(ctx.mcpRegistry.getSnapshot()).toHaveLength(1)
    await scope.dispose()
  })

  it('checks real registry drift and removes invariant listeners on unload', async () => {
    const endpoint = await httpFixture()
    const { ctx } = await compose(httpConfig(endpoint.url), managed())
    await ctx.plugin(InvariantRegistry)
    const companion = ctx.plugin(McpInvariant)
    await companion.await()
    const dispatch = (): void => { ctx.events.dispatch('waterfall', ['tools/pre-execute']) }
    expect(dispatch).not.toThrow()
    const getter = vi.spyOn(ctx.tools, 'get').mockReturnValue(undefined)
    expect(dispatch).toThrow(/MCP discovery lists a tool absent/)
    await companion.dispose()
    expect(dispatch).not.toThrow()
    getter.mockRestore()
  })

  it('contains observer failures and leaves cancelled probes unable to replace tools', async () => {
    const endpoint = await httpFixture()
    const { handle } = await compose(httpConfig(endpoint.url), managed())
    const observer = vi.fn(() => { throw new Error('observer secret') })
    handle!.subscribe(observer)
    const stopped = new AbortController()
    stopped.abort()
    const snapshot = handle!.getSnapshot()
    await expect(handle!.probe(stopped.signal)).rejects.toMatchObject({ code: 'connection-failed' })
    expect(handle!.getSnapshot()).toBe(snapshot)
    await handle!.probe(new AbortController().signal)
    expect(observer).toHaveBeenCalled()
    const firstStop = handle!.dispose()
    expect(handle!.dispose()).toBe(firstStop)
    await firstStop
    expect(handle!.getSnapshot().phase).toBe('stopped')
  })
})
