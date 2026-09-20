/** Host connection handles retain resource execution authority outside Client observation types. */

import type { McpResourceProvider } from '@deepseek-ai/dsh-mcp-resources'
import type { ConnectionOutcome, McpConnectionState, McpToolDescriptor } from './types.ts'

/** One supervised connection, including live observation and explicit discovery. */
export interface ConnectionHandle {
  readonly ready: Promise<ConnectionOutcome>
  /** Resource operations use the initialized current generation and fail while disconnected. */
  readonly resources: McpResourceProvider
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
