/** Resource protocol tests mock only the MCP client and transport. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boot } from '@deepseek-ai/dsh-app-boot'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecution } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { brandString } from '@deepseek-ai/dsh-brand'
import McpResources from '@deepseek-ai/dsh-mcp-resources'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

const { instances, connect, instructions, capabilities, resourceRequest, MockClient } = vi.hoisted(() => {
  const connect = vi.fn<() => Promise<void>>()
  const instructions = vi.fn<() => string | undefined>()
  const capabilities = vi.fn<() => { tools?: object; resources?: object }>()
  const resourceRequest = vi.fn<(
    request: { method: string; params?: Record<string, unknown> },
    options: { signal: AbortSignal; timeout: number },
  ) => Promise<JsonValue>>()
  class MockClient {
    getInstructions = instructions
    onclose?: () => void
    onerror?: (error: Error) => void
    connect = connect
    getServerCapabilities = capabilities
    setNotificationHandler = vi.fn()
    request = vi.fn(async (
      request: { method: string; params?: Record<string, unknown> },
      schema: { parse: (result: unknown) => unknown },
      options: { signal: AbortSignal; timeout: number },
    ): Promise<unknown> => {
      if (request.method === 'tools/list') return { tools: [] }
      return schema.parse(await resourceRequest(request, options))
    })
    close = vi.fn(async () => { this.onclose?.() })
    constructor() { instances.push(this) }
  }
  const instances: MockClient[] = []
  return { instances, connect, instructions, capabilities, resourceRequest, MockClient }
})

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: MockClient }))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: vi.fn() }))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: vi.fn() }))

import * as McpClient from '../src/index.ts'
import type { Config, ConnectionHandle, McpLaunchOptions, McpServerId } from '../src/index.ts'

const config: Config = {
  transport: 'stdio', serverName: 'docs', command: 'mock', args: [], env: {}, cwd: '',
  toolCallTimeoutMs: 1234, failOnStartupError: true, reconnect: { enabled: false },
}
const roots: Context[] = []
const temporary: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
  vi.useRealTimers()
})
beforeEach(() => {
  vi.clearAllMocks()
  instances.length = 0
  connect.mockResolvedValue(undefined)
  instructions.mockReturnValue(undefined)
  capabilities.mockReturnValue({ tools: {}, resources: {} })
  resourceRequest.mockResolvedValue({ resources: [] })
})

async function setup(resources = true) {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (resources) await ctx.plugin(McpResources)
  return ctx
}

function call(ctx: Context, name: string, args: unknown, signal = new AbortController().signal, agent?: Agent) {
  return ctx.tools.execute({
    name, arguments: args, signal, callId: ToolCallId('resource-call'),
    ...agent === undefined ? {} : { agent },
  })
}

async function launch(ctx: Context, options: McpLaunchOptions = {}, resolved = config) {
  let handle!: ConnectionHandle
  const fiber = ctx.plugin({ inject: ['tools'], async apply(inner: Context) {
    handle = McpClient.launchMcpClient(inner, resolved, options)
    await handle.ready
  } })
  await fiber
  return { fiber, handle }
}

describe('MCP connection resource requests', () => {
  it('publishes literal attributed instructions only after successful startup and withdraws them on close', async () => {
    const ctx = await setup()
    const initializing: PromiseWithResolvers<void> = Promise.withResolvers()
    connect.mockReturnValueOnce(initializing.promise)
    instructions.mockReturnValue('Read {{literal}} and 保留.  \n')
    const loading = launch(ctx)
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('Read {{literal}}')
    initializing.resolve()
    const { fiber } = await loading
    const section = (await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'mcp:docs')
    expect(section).toMatchObject({ interpolate: false, text: '### MCP server: docs\n\nRead {{literal}} and 保留.' })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('Read {{literal}} and 保留.')
    instances[0]!.onclose?.()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('Read {{literal}}')
    await fiber.dispose()
    expect((await ctx.systemPrompt.assemble()).sections.some(section => section.name === 'mcp:docs')).toBe(false)
  })

  it('omits empty instructions and does not publish instructions when discovery fails', async () => {
    const ctx = await setup()
    await ctx.plugin(McpClient, config)
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('### MCP server: docs')
    const other = await setup()
    instructions.mockReturnValue('Uncommitted instruction.')
    connect.mockImplementationOnce(async () => {
      instances.at(-1)!.request.mockRejectedValue(new Error('discovery failed'))
    })
    const { handle } = await launch(other)
    expect((await handle.ready).error).toBeDefined()
    expect(renderPrompt(await other.systemPrompt.assemble())).not.toContain('Uncommitted instruction.')
  })

  it('replaces instruction text on reconnect and keeps disposed generations out of prompts', async () => {
    const ctx = await setup()
    vi.useFakeTimers()
    instructions.mockReturnValueOnce('First generation.').mockReturnValueOnce('Second generation.')
    const { handle } = await launch(ctx, {}, { ...config, reconnect: { initialDelayMs: 5, maxDelayMs: 10, maxAttempts: 2 } })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('First generation.')
    instances[0]!.onclose?.()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('First generation.')
    await vi.advanceTimersByTimeAsync(5)
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('Second generation.')
    instances[0]!.onclose?.()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('Second generation.')
    await handle.dispose()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('Second generation.')
  })

  it.each([0, -1])('bounds complete attributed instructions at a UTF-8 byte limit (offset %s)', async (offset) => {
    const ctx = await setup()
    instructions.mockReturnValue('保留')
    const text = '### MCP server: docs\n\n保留'
    const { handle } = await launch(ctx, {}, { ...config, maxInstructionBytes: Buffer.byteLength(text) + offset })
    const result = await handle.ready
    if (offset === 0) {
      expect(result.error).toBeUndefined()
      expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain(text)
    } else {
      expect(result.error).toBeInstanceOf(Error)
      expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('保留')
      expect(instances[0]!.request).not.toHaveBeenCalled()
    }
  })

  it('rejects an invalid instruction limit before reserving the server name', async () => {
    const ctx = await setup()
    expect(() => McpClient.launchMcpClient(ctx, { ...config, maxInstructionBytes: 0 })).toThrow('positive safe integer')
    expect(() => McpClient.Config({ ...config, maxInstructionBytes: 1.5 })).toThrow()
    await ctx.plugin(McpClient, config)
    expect(instances).toHaveLength(1)
  })

  it('redacts attributed instructions and exposes scoped instructions only in the owner scope', async () => {
    const ctx = await setup()
    const owner = {} as Agent
    const other = {} as Agent
    const scope = createScope(ctx, owner)
    instructions.mockReturnValue('Use fixture-secret.')
    await launch(scope.ctx, { redact: text => text.replaceAll('fixture-secret', '[redacted]') })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('### MCP server: docs')
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: other, agent: other }))).not.toContain('### MCP server: docs')
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: owner, agent: owner }))).toContain('Use [redacted].')
    await scope.dispose()
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: owner, agent: owner }))).not.toContain('Use [redacted].')
  })

  it.each([false, true])('unloads during initialize and awaits confirmed closure (strict startup %s)', async (failOnStartupError) => {
    const ctx = await setup()
    const initializing: PromiseWithResolvers<void> = Promise.withResolvers()
    const closing: PromiseWithResolvers<void> = Promise.withResolvers()
    const closed: PromiseWithResolvers<void> = Promise.withResolvers()
    connect.mockReturnValueOnce(initializing.promise)
    const fiber = ctx.plugin(McpClient, { ...config, failOnStartupError })
    const activated = fiber.then(() => 'activated', () => 'rejected')
    await vi.waitFor(() => { expect(instances).toHaveLength(1) })
    instances[0]!.close.mockImplementationOnce(async () => {
      closing.resolve()
      await closed.promise
      initializing.reject(new Error('initialize cancelled by close'))
      instances[0]!.onclose?.()
    })
    let disposed = false
    const disposing = fiber.dispose().then(() => { disposed = true })
    await closing.promise
    expect(disposed).toBe(false)
    expect(instances[0]!.close).toHaveBeenCalledOnce()
    closed.resolve()
    await disposing
    await activated
    expect(ctx.tools.get('list_mcp_resources')).toBeUndefined()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('### MCP server: docs')
    await ctx.plugin(McpClient, config)
    expect(instances).toHaveLength(2)
  })

  it('boots the resource tools through Loader and withdraws them when the client unloads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-resource-loader-'))
    temporary.push(directory)
    const path = join(directory, 'cordis.yml')
    await copyFile(new URL('./fixtures/resources.cordis.yml', import.meta.url), path)
    const ctx = await boot('mcp-resources-test', path,
      [{ insert: [{ id: 'server', name: 'cordis:test-mcp', config }] }], (root) => {
        roots.push(root)
        root.loader.builtins['test-system-prompt'] = SystemPrompt
        root.loader.builtins['test-tools'] = ToolRuntime
        root.loader.builtins['test-resources'] = McpResources
        root.loader.builtins['test-mcp'] = McpClient
      })
    const prompt = renderPrompt(await ctx.systemPrompt.assemble())
    expect(prompt).toContain('server argument: ["docs"]')
    resourceRequest.mockResolvedValue({ contents: [{ uri: 'docs://readme', text: 'Loader resource result.' }] })
    const result = await call(ctx, 'read_mcp_resource', { server: 'docs', uri: 'docs://readme' })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.content)).toContain('Loader resource result.')
    await ctx.loader.resolve('include:server').fiber!.dispose()
    expect(ctx.tools.get('read_mcp_resource')).toBeUndefined()
    expect(instances[0]!.close).toHaveBeenCalledOnce()
  })

  it('preserves resource pages, template URIs, read contents, and request deadlines', async () => {
    const ctx = await setup()
    await ctx.plugin(McpClient, config)
    resourceRequest.mockImplementation(async (request) => {
      if (request.method === 'resources/templates/list') return {
        resourceTemplates: [{ name: 'guide', uriTemplate: 'docs://guide/{topic}', mimeType: 'text/plain' }],
        nextCursor: 'template-next',
      }
      if (request.method === 'resources/read') return {
        contents: [{ uri: 'docs://guide/setup', mimeType: 'text/plain', text: 'Installation guide.' }],
      }
      return { resources: [{ name: 'readme', uri: 'docs://readme' }], nextCursor: 'opaque-next' }
    })
    const first = await call(ctx, 'list_mcp_resources', { server: 'docs' })
    expect(first.value).toEqual({ resources: [{ name: 'readme', uri: 'docs://readme' }], nextCursor: 'opaque-next' })
    await call(ctx, 'list_mcp_resources', { server: 'docs', cursor: 'opaque-next' })
    const templates = await call(ctx, 'list_mcp_resource_templates', { server: 'docs', cursor: 'template-page' })
    expect(templates.value).toMatchObject({ resourceTemplates: [{ uriTemplate: 'docs://guide/{topic}' }], nextCursor: 'template-next' })
    const read = await call(ctx, 'read_mcp_resource', { server: 'docs', uri: 'docs://guide/setup' })
    expect(read.content).toEqual([{ type: 'text', text: 'MCP server: docs\n{"contents":[{"uri":"docs://guide/setup","mimeType":"text/plain","text":"Installation guide."}]}' }])
    expect(resourceRequest.mock.calls.map(([request]) => request)).toEqual([
      { method: 'resources/list' },
      { method: 'resources/list', params: { cursor: 'opaque-next' } },
      { method: 'resources/templates/list', params: { cursor: 'template-page' } },
      { method: 'resources/read', params: { uri: 'docs://guide/setup' } },
    ])
    for (const [, options] of resourceRequest.mock.calls) {
      expect(options.timeout).toBe(1234)
      expect(options.signal.aborted).toBe(false)
    }
  })

  it('connects a resource-only server without sending tools/list', async () => {
    capabilities.mockReturnValue({ resources: {} })
    const ctx = await setup()
    await ctx.plugin(McpClient, config)
    expect(instances[0]!.request).not.toHaveBeenCalled()
    expect((await call(ctx, 'list_mcp_resources', { server: 'docs' })).isError).toBe(false)
    expect(instances[0]!.request).toHaveBeenCalledOnce()
  })

  it('returns empty lists for a server without resources and rejects reads', async () => {
    capabilities.mockReturnValue({ tools: {} })
    const ctx = await setup()
    await ctx.plugin(McpClient, config)
    expect((await call(ctx, 'list_mcp_resources', { server: 'docs' })).value).toEqual({ resources: [] })
    expect((await call(ctx, 'list_mcp_resource_templates', { server: 'docs' })).value).toEqual({ resourceTemplates: [] })
    const read = await call(ctx, 'read_mcp_resource', { server: 'docs', uri: 'docs://readme' })
    expect(read.isError).toBe(true)
    expect(JSON.stringify(read.content)).toContain('does not support resources')
    expect(resourceRequest).not.toHaveBeenCalled()
  })

  it('registers through late service injection and removes providers with the client', async () => {
    const ctx = await setup(false)
    const client = await ctx.plugin(McpClient, config)
    expect(ctx.tools.get('list_mcp_resources')).toBeUndefined()
    await ctx.plugin(McpResources)
    await vi.waitFor(() => { expect(ctx.tools.get('list_mcp_resources')).toBeDefined() })
    expect((await call(ctx, 'list_mcp_resources', { server: 'docs' })).isError).toBe(false)
    await client.dispose()
    expect(ctx.tools.get('list_mcp_resources')).toBeUndefined()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('MCP resource servers')
    expect(instances[0]!.close).toHaveBeenCalledOnce()
  })

  it('registers a launched provider in the caller scope', async () => {
    const ctx = await setup()
    const owner = {} as Agent
    const scoped = createScope(ctx, owner)
    await scoped.ctx.plugin(McpClient, config)
    expect(ctx.tools.get('list_mcp_resources')).toBeUndefined()
    expect((await call(ctx, 'list_mcp_resources', { server: 'docs' }, undefined, owner)).isError).toBe(false)
    await scoped.dispose()
    expect(ctx.tools.get('list_mcp_resources', owner)).toBeUndefined()
  })

  it.each(['caller', 'disconnect', 'dispose'] as const)('cancels an active request on %s', async (cause) => {
    const ctx = await setup()
    const { fiber } = await launch(ctx)
    const started: PromiseWithResolvers<AbortSignal> = Promise.withResolvers()
    resourceRequest.mockImplementation((_request, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => { reject(new Error('resource request aborted')) }, { once: true })
      started.resolve(options.signal)
    }))
    const controller = new AbortController()
    const reading = call(ctx, 'read_mcp_resource', { server: 'docs', uri: 'docs://held' }, controller.signal)
    const signal = await started.promise
    if (cause === 'caller') controller.abort()
    if (cause === 'disconnect') instances[0]!.onclose?.()
    if (cause === 'dispose') await fiber.dispose()
    expect(signal.aborted).toBe(true)
    expect((await reading).isError).toBe(true)
  })

  it('rejects calls during connection negotiation and after disposal without sending a request', async () => {
    const ctx = await setup()
    const negotiating: PromiseWithResolvers<void> = Promise.withResolvers()
    connect.mockReturnValue(negotiating.promise)
    const handle = McpClient.launchMcpClient(ctx, config)
    const execution = { signal: new AbortController().signal } as ToolExecution
    await expect(handle.resources.request({ method: 'resources/list' }, execution)).rejects.toThrow()
    negotiating.resolve()
    await handle.ready
    await handle.dispose()
    await expect(handle.resources.request({ method: 'resources/read', uri: 'docs://readme' }, execution)).rejects.toThrow()
    expect(resourceRequest).not.toHaveBeenCalled()
  })

  it('keeps provider names during an outage and routes recovery through the new generation', async () => {
    const ctx = await setup()
    vi.useFakeTimers()
    await launch(ctx, {}, { ...config, reconnect: { initialDelayMs: 5, maxDelayMs: 10, maxAttempts: 2 } })
    instances[0]!.onclose?.()
    expect((await call(ctx, 'list_mcp_resources', { server: 'docs' })).isError).toBe(true)
    expect(resourceRequest).not.toHaveBeenCalled()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain('server argument: ["docs"]')
    await vi.advanceTimersByTimeAsync(5)
    expect(instances).toHaveLength(2)
    expect((await call(ctx, 'list_mcp_resources', { server: 'docs' })).isError).toBe(false)
    expect(instances[0]!.request).toHaveBeenCalledTimes(1)
    expect(instances[1]!.request).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])('preserves managed error redaction (managed: %s)', async (managed) => {
    const ctx = await setup()
    await launch(ctx, managed ? { owner: { kind: 'managed', recordId: brandString<McpServerId>('record') } } : {})
    resourceRequest.mockRejectedValue(new Error('upstream credential fixture-secret'))
    const result = await call(ctx, 'list_mcp_resources', { server: 'docs' })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content).includes('fixture-secret')).toBe(!managed)
  })

  it('rejects malformed wire content and retains canonical binary content outside model text', async () => {
    const ctx = await setup()
    await ctx.plugin(McpClient, config)
    resourceRequest.mockResolvedValueOnce({ contents: [{ text: 'missing URI' }] })
    expect((await call(ctx, 'read_mcp_resource', { server: 'docs', uri: 'docs://bad' })).isError).toBe(true)
    const value = { contents: [{ uri: 'docs://binary', mimeType: 'application/octet-stream', blob: 'AQIDBA==' }] }
    resourceRequest.mockResolvedValueOnce(value)
    const result = await call(ctx, 'read_mcp_resource', { server: 'docs', uri: 'docs://binary' })
    expect(result.value).toEqual(value)
    expect(JSON.stringify(result.content)).not.toContain('AQIDBA==')
    expect(JSON.stringify(result.content)).toContain('8 base64 characters')
  })
})
