/**
 * MCP client bridge plugin: connects to an external MCP server and registers
 * its tools on `ctx.tools` under server-qualified public names
 * (`mcp__<serverName>__<rawName>`). Each plugin instance connects to one MCP
 * server; load multiple instances in `cordis.yml` for multiple servers.
 *
 * Namespace plugin (named exports, no default export). Lifecycle is
 * effect-scoped: disposal disconnects from the server, unregisters all tools,
 * and releases the `serverName` namespace reservation. HMR hot-swaps by
 * disposing the old instance and creating a new one; identical `serverName`
 * reproduces identical public tool names.
 *
 * @module @deepseek-ai/dsh-mcp-client
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { contributeConnection } from './registry-internal.ts'
import type {} from './registry.ts'
import { McpConnectionFailure } from './failure.ts'
import type {
  McpConnectionId, McpConnectionState, McpLaunchOptions, McpOwner,
} from './types.ts'
import type { ConnectionHandle } from './host-types.ts'
import z from '@deepseek-ai/schemastery'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { DEFAULT_MAX_INSTRUCTION_BYTES, RECONNECT_DEFAULTS, resolveReconnectPolicy, startConnection } from './connection.ts'
import type { ReconnectConfig } from './connection.ts'
import { registerServerContext } from './server-context.ts'
// Side-effect type import: declaration-merges `ctx.tools` onto Context.
import type {} from '@deepseek-ai/dsh-tools'

export { createMcpToolDefinition } from './tools.ts'
export type { McpResult, McpToolDefinitionOptions } from './tools.ts'
export type { ReconnectConfig, ResolvedReconnectPolicy } from './connection.ts'
export { resolveReconnectPolicy } from './connection.ts'
export { McpConnectionFailure } from './failure.ts'
export type {
  ConnectionOutcome, McpConnectionError, McpConnectionId, McpConnectionSnapshot,
  McpConnectionState, McpLaunchOptions, McpOwner, McpServerId, McpToolDescriptor,
} from './types.ts'
export type { ConnectionHandle } from './host-types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mcp-client'

/** Services required by this plugin. */
export const inject = ['tools']

/** Default timeout for individual MCP tool calls and resource requests (ms). */
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

/** Config for connecting to an MCP server via a spawned child process over stdio. */
export interface StdioConfig {
  /** Selects child-process stdio transport. */
  transport: 'stdio'
  /**
   * Stable local namespace for this server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`). Must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across live mcp-client instances.
   */
  serverName: string
  /** Executable used to start the server. */
  command: string
  /** Arguments passed directly, without shell interpolation. */
  args: string[]
  /** Extra env vars merged on top of scrubbed ambient env. */
  env: Record<string, string>
  /** Working directory for the child process. */
  cwd: string
  /** Timeout per tool call or resource request in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Maximum UTF-8 bytes of attributed server instructions (default 32768). */
  maxInstructionBytes?: number
  /** Automatic reconnect policy after a lost connection; omission uses the defaults. */
  reconnect?: ReconnectConfig
}

/** Config for connecting to an MCP server over Streamable HTTP (SSE). */
export interface StreamableHttpConfig {
  /** Selects Streamable HTTP transport. */
  transport: 'streamable-http'
  /**
   * Stable local namespace for this server's model-facing tool names
   * (`mcp__<serverName>__<rawName>`). Must match `[A-Za-z0-9_-]{1,32}` and be
   * unique across live mcp-client instances.
   */
  serverName: string
  /** MCP endpoint URL. */
  url: string
  /** Additional headers attached to MCP requests. */
  headers: Record<string, string>
  /** Timeout per tool call or resource request in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Maximum UTF-8 bytes of attributed server instructions (default 32768). */
  maxInstructionBytes?: number
  /** Automatic reconnect policy after a lost connection; omission uses the defaults. */
  reconnect?: ReconnectConfig
}

/** Configuration for one stdio or Streamable HTTP MCP server. */
export type Config = StdioConfig | StreamableHttpConfig

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
    maxInstructionBytes: z.number().step(1).min(1).default(DEFAULT_MAX_INSTRUCTION_BYTES),
    reconnect: Reconnect,
  }),
  z.object({
    transport: z.const('streamable-http'),
    serverName: z.string().required().pattern(SERVER_NAME_PATTERN),
    url: z.string().required(),
    headers: z.dict(String).default({}),
    toolCallTimeoutMs: z.number().default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
    failOnStartupError: z.boolean().default(false),
    maxInstructionBytes: z.number().step(1).min(1).default(DEFAULT_MAX_INSTRUCTION_BYTES),
    reconnect: Reconnect,
  }),
]) as z<ConfigInput, Config>

/**
 * Launch one MCP instance with the same namespace and effects as the plugin entry.
 * @param ctx - context owning this instance and providing tools.
 * @param config - resolved MCP configuration; launch authority is never read from it.
 * @param options - private owner, credential resolver, and metadata redactor.
 * @returns a handle whose disposal releases its namespace after transport cleanup.
 */
export function launchMcpClient(ctx: Context, config: Config, options: McpLaunchOptions = {}): ConnectionHandle {
  const reconnect = resolveReconnectPolicy(config.reconnect, `mcp-client(${config.serverName}): reconnect`)
  const maxInstructionBytes = config.maxInstructionBytes ?? DEFAULT_MAX_INSTRUCTION_BYTES
  if (!Number.isSafeInteger(maxInstructionBytes) || maxInstructionBytes < 1) {
    throw new Error(`mcp-client(${config.serverName}): maxInstructionBytes must be a positive safe integer`)
  }
  let handle!: ConnectionHandle
  ctx.effect(() => {
    const scope = scopeOf(ctx) ?? ctx.root
    let names = activeServerNames.get(scope)
    if (!names) {
      names = new Set()
      activeServerNames.set(scope, names)
    }
    if (names.has(config.serverName)) {
      if (options.owner?.kind === 'managed') throw new McpConnectionFailure('namespace-conflict')
      throw new Error(
        `mcp-client: serverName "${config.serverName}" is already in use by another mcp-client instance — pick a unique serverName in cordis.yml`,
      )
    }
    names.add(config.serverName)
    const connection = startConnection(ctx, config, reconnect)
    registerServerContext(ctx, config.serverName, connection)

    let stopping: Promise<void> | undefined
    const listeners = new Set<() => void>()
    let state: McpConnectionState = { phase: 'connecting', attempt: 0, tools: [] }

    void connection.ready.then(
      (outcome) => {
        if (outcome.error !== undefined) {
          state = { phase: 'error', attempt: 0, tools: [], errorCode: 'connection-failed' }
        } else {
          state = { phase: 'ready', attempt: 0, tools: [] }
        }
        for (const listener of listeners) listener()
      },
      () => {
        state = { phase: 'error', attempt: 0, tools: [], errorCode: 'connection-failed' }
        for (const listener of listeners) listener()
      },
    )

    handle = {
      ready: connection.ready,
      resources: connection.resources,
      dispose: () => stopping ??= (async () => {
        state = { phase: 'stopped', attempt: 0, tools: [] }
        for (const listener of listeners) listener()
        await connection.dispose()
        if (state.errorCode !== 'close-timeout') names.delete(config.serverName)
      })(),
      getSnapshot: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => void listeners.delete(listener)
      },
      probe: async (_signal: AbortSignal) => {
        return state.tools
      },
    }
    return () => handle.dispose()
  }, 'mcp-client.connection')

  ctx.on('internal/plugin', (fiber) => {
    if (fiber !== ctx.fiber || fiber.uid !== null) return
    return handle?.dispose()
  }, { global: true })

  const registry = ctx.get('mcpRegistry')
  if (scopeOf(ctx) === undefined && registry !== undefined) {
    const loader = ctx.get('loader') as { locate?(fiber: unknown): string } | undefined
    const label = loader?.locate?.(ctx.fiber) ?? ctx.fiber.runtime?.name ?? 'root'
    const owner: McpOwner = options.owner === undefined
      ? { kind: 'composition', label }
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

// ---- Plugin apply ----

/**
 * Connect one MCP server and publish its initial tool generation before activation.
 * This entry remains explicitly `async`: Cordis treats a prototype-bearing
 * ordinary function as a constructor, whose returned Promise is not startup work.
 * @param ctx - plugin context carrying the tool registry.
 * @param config - resolved transport and server namespace configuration.
 * @returns startup readiness after connection and initial tool discovery settle.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const connection = launchMcpClient(ctx, config)
  const outcome = await connection.ready
  if (outcome.error !== undefined && config.failOnStartupError) {
    throw new Error(`mcp-client(${config.serverName}): initial connection or tool synchronization failed`, { cause: outcome.error })
  }
}
