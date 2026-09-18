/**
 * MCP client bridge plugin: connects to an external MCP server and registers
 * its tools on `ctx.tools` under server-qualified public names
 * (`mcp__<serverName>__<rawName>`). Each plugin instance connects to one MCP
 * server; load multiple instances in `cordis.yml` for multiple servers.
 *
 * Namespace plugin (named exports, no default export). Lifecycle is
 * effect-scoped: disposal disconnects from the server, unregisters all tools,
 * and releases the namespace after confirmed shutdown. A close timeout keeps
 * the namespace reserved until Host restart. HMR replaces the old instance; identical `serverName`
 * reproduces identical public tool names.
 *
 * @module @deepseek-ai/dsh-mcp-client
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { brandString } from '@deepseek-ai/dsh-brand'
import { contributeConnection } from './registry-internal.ts'
import type {} from './registry.ts'
import { McpConnectionFailure } from './failure.ts'
import type { Config as McpConfig, StdioConfig, StreamableHttpConfig, ConnectionHandle, McpConnectionId, McpLaunchOptions, McpOwner } from './types.ts'
import z from '@deepseek-ai/schemastery'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { RECONNECT_DEFAULTS, resolveReconnectPolicy, startConnection } from './connection.ts'
import type { ReconnectConfig } from './connection.ts'
// Side-effect type import: declaration-merges `ctx.tools` onto Context.
import type {} from '@deepseek-ai/dsh-tools'

export type { McpResult } from './tools.ts'
export type { ReconnectConfig, ResolvedReconnectPolicy } from './connection.ts'
export { resolveReconnectPolicy } from './connection.ts'
export { McpConnectionFailure } from './failure.ts'
export type { ConnectionHandle, ConnectionOutcome, McpConnectionError, McpConnectionId, McpConnectionSnapshot, McpConnectionState, McpLaunchOptions, McpOwner, McpServerId, McpToolDescriptor } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-client'

/** Services required by this plugin. */
export const inject = ['tools']

/** Default timeout for individual MCP tool calls (ms). */
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/** Valid `serverName`, kept below the public tool-name budget. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/**
 * Live `serverName` reservations per registration scope. Agent-scoped MCP
 * servers may reuse a namespace in another Agent, while global instances and
 * duplicates inside one Agent remain mutually exclusive.
 */
const activeServerNames = new WeakMap<object, Set<string>>()

// ---- Config ----

/** Configuration for one MCP transport. */
export type Config = McpConfig
export type { StdioConfig, StreamableHttpConfig } from './types.ts'

type StdioConfigInput = Omit<StdioConfig, 'args' | 'env' | 'cwd' | 'toolCallTimeoutMs' | 'failOnStartupError'>
  & Partial<Pick<StdioConfig, 'args' | 'env' | 'cwd' | 'toolCallTimeoutMs' | 'failOnStartupError'>>
type StreamableHttpConfigInput = Omit<StreamableHttpConfig, 'headers' | 'toolCallTimeoutMs' | 'failOnStartupError'>
  & Partial<Pick<StreamableHttpConfig, 'headers' | 'toolCallTimeoutMs' | 'failOnStartupError'>>
type ConfigInput = StdioConfigInput | StreamableHttpConfigInput

const Reconnect: z<ReconnectConfig> = z.object({
  enabled: z.boolean().default(RECONNECT_DEFAULTS.enabled),
  initialDelayMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(RECONNECT_DEFAULTS.initialDelayMs),
  maxDelayMs: z.number().min(1).max(MAX_TIMER_DELAY_MS).default(RECONNECT_DEFAULTS.maxDelayMs),
  maxAttempts: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(RECONNECT_DEFAULTS.maxAttempts),
})

export const Config = z.union([
  z.object({
    transport: z.const('stdio'),
    serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
    command: z.string().required(),
    args: z.array(String).default([]),
    env: z.dict(String).default({}),
    cwd: z.string().default(''),
    toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
    failOnStartupError: z.boolean().default(false),
    reconnect: Reconnect,
  }),
  z.object({
    transport: z.const('streamable-http'),
    serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
    url: z.string().required(),
    headers: z.dict(String).default({}),
    toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
    failOnStartupError: z.boolean().default(false),
    reconnect: Reconnect,
  }),
]) as unknown as z<ConfigInput, Config>

/**
 * Launch one MCP instance with the same namespace and effects as the plugin entry.
 * @param ctx - context owning this instance and providing tools.
 * @param config - resolved MCP configuration; launch authority is never read from it.
 * @param options - private owner, credential resolver, and metadata redactor.
 * @returns a handle whose disposal releases its namespace after transport cleanup.
 */
export function launchMcpClient(ctx: Context, config: Config, options: McpLaunchOptions = {}): ConnectionHandle {
  const reconnect = resolveReconnectPolicy(config.reconnect, 'mcp-client(' + config.serverName + '): reconnect')
  let handle!: ConnectionHandle
  ctx.effect(() => {
    const scope = scopeOf(ctx) ?? ctx.root
    let names = activeServerNames.get(scope)
    if (names === undefined) { names = new Set(); activeServerNames.set(scope, names) }
    if (names.has(config.serverName)) {
      if (options.owner?.kind === 'managed') throw new McpConnectionFailure('namespace-conflict')
      throw new Error('mcp-client: serverName "' + config.serverName + '" is already in use by another mcp-client instance — pick a unique serverName in cordis.yml')
    }
    names.add(config.serverName)
    const connection = startConnection(ctx, config, reconnect, options)
    let stopping: Promise<void> | undefined
    handle = {
      ...connection,
      dispose: () => stopping ??= (async () => {
        await connection.dispose()
        // Cordis unloads independent effects concurrently. Keep namespace
        // release in this cleanup, after transport shutdown is acknowledged.
        if (connection.getSnapshot().errorCode !== 'close-timeout') names.delete(config.serverName)
      })(),
    }
    return () => handle.dispose()
  }, 'mcp-client.connection')
  const registry = ctx.get('mcpRegistry')
  if (scopeOf(ctx) === undefined && registry !== undefined) {
    const owner: McpOwner = options.owner === undefined
      ? { kind: 'composition', label: ctx.get('loader')?.locate(ctx.fiber) ?? ctx.fiber.runtime?.name ?? 'root' }
      : { ...options.owner }
    contributeConnection(ctx, registry, {
      id: brandString<McpConnectionId>(randomUUID()),
      serverName: config.serverName,
      transport: config.transport,
      owner: Object.freeze(owner),
    }, handle)
  }
  return handle
}

/**
 * Connect and discover tools before Cordis activates this plugin.
 * @param ctx - plugin context carrying the tool registry.
 * @param config - resolved configuration.
 * @returns initial connection settlement; strict startup rejects failed discovery.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const connection = launchMcpClient(ctx, config)
  const outcome = await connection.ready
  if (outcome.error !== undefined && config.failOnStartupError) {
    throw new Error('mcp-client(' + config.serverName + '): initial connection or tool synchronization failed', { cause: outcome.error })
  }
}
