/** Public, secret-free observations of MCP connections. @module */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools/types'
/** Automatic reconnect policy for one MCP server connection. */
export interface ReconnectConfig {
  /** Reconnect after lost connections; defaults to true. */
  enabled?: boolean
  /** First retry delay in milliseconds; defaults to 500. */
  initialDelayMs?: number
  /** Delay ceiling and stable-uptime reset window; defaults to 30000 milliseconds. */
  maxDelayMs?: number
  /** Consecutive reconnect attempt cap; defaults to 10. */
  maxAttempts?: number
}

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
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
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
  /** Per-tool-call timeout in milliseconds. */
  toolCallTimeoutMs: number
  /** Fail plugin activation when the initial connection or tool synchronization fails. */
  failOnStartupError: boolean
  /** Automatic reconnect policy after a lost connection; omission uses the defaults. */
  reconnect?: ReconnectConfig
}

/** Configuration for one stdio or Streamable HTTP MCP server. */
export type Config = StdioConfig | StreamableHttpConfig


/** Durable address assigned by a profile's MCP record owner. */
export type McpServerId = Branded<'McpServerId'>

/** Address of one live launcher instance; never a durable server address. */
export type McpConnectionId = Branded<'McpConnectionId'>

/** Authority supplied by the launcher or observed from the composition. */
export type McpOwner =
  | { readonly kind: 'managed'; readonly recordId: McpServerId }
  | { readonly kind: 'composition'; readonly label: string }

/** Stable failure classification containing no upstream text or credentials. */
export type McpConnectionError =
  | 'missing-credential'
  | 'authentication-failed'
  | 'connection-failed'
  | 'tool-sync-failed'
  | 'namespace-conflict'
  | 'close-timeout'

/** Public tool metadata from the last committed discovery. */
export interface McpToolDescriptor {
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonSchemaNode
}

/** Local lifecycle observation; ready means no error observed after the last discovery. */
export interface McpConnectionState {
  readonly phase: 'connecting' | 'ready' | 'backoff' | 'error' | 'stopped'
  /** Zero for startup; otherwise the current outage's reconnect attempt number. */
  readonly attempt: number
  /** Unix milliseconds of a scheduled reconnect, present only during backoff. */
  readonly retryAt?: number
  readonly errorCode?: McpConnectionError
  /** Registrations retained during outages; empty after stop or exhaustion. */
  readonly tools: readonly McpToolDescriptor[]
}

/** Root-scope connection observation without executable or authorization configuration. */
export interface McpConnectionSnapshot extends McpConnectionState {
  readonly id: McpConnectionId
  readonly serverName: string
  readonly transport: Config['transport']
  readonly owner: McpOwner
}

/** Initial-attempt settlement; a successful promise alone does not imply readiness. */
export interface ConnectionOutcome {
  readonly error?: unknown
}

/** One supervised connection, including live observation and explicit discovery. */
export interface ConnectionHandle {
  readonly ready: Promise<ConnectionOutcome>
  /**
   * Stop and await cleanup; concurrent callers join the same completion.
   * A close timeout remains observable as stopped with errorCode close-timeout.
   * @returns cleanup settlement without reopening a timed-out namespace.
   */
  dispose(): Promise<void>
  /** Read an immutable lifecycle observation. @returns the latest committed state. */
  getSnapshot(): McpConnectionState
  /** Observe committed changes until unsubscribed or stopped. @param listener - change callback. @returns unsubscribe. */
  subscribe(listener: () => void): () => void
  /**
   * Refresh tools on an initialized live connection, including recovery from an observed error.
   * Calls no tool. Cancellation leaves the previous tool generation untouched.
   * @param signal - cancels queued or in-flight discovery.
   * @returns the newly committed descriptors.
   * @throws when stopped, disconnected, cancelled, or discovery fails.
   */
  probe(signal: AbortSignal): Promise<readonly McpToolDescriptor[]>
}

/** Private launch-time authority and credential resolution, never plugin configuration. */
export interface McpLaunchOptions {
  readonly owner?: McpOwner
  /** Resolve fresh transport credentials for each attempt. The server identity must stay unchanged. */
  readonly resolveConfig?: (signal: AbortSignal) => Promise<Config>
  /** Remove known secret values from public tool descriptions and schemas. */
  readonly redact?: (text: string) => string
}
