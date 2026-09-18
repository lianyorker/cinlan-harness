/** MCP Remote exposes profile-owned desired state and secret-free bridge observations. */
import { Context } from '@deepseek-ai/cordis'
import { McpManagementError } from '@deepseek-ai/dsh-mcp-management'
import type {} from '@deepseek-ai/dsh-mcp-management'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  McpManagementSnapshot, McpRemoveRequest, McpSaveRequest, McpSaveResult, McpServerRequest, McpSetEnabledRequest,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { mcpController: McpController }
}

/** Current-profile MCP management without composition rewrites or tool execution. */
export class McpController extends TypertRemoteService {
  static inject = ['typert', 'mcpManagement']
  private readonly lifetime = new AbortController()

  /** @param ctx - Remote registry and current-profile management service. */
  constructor(ctx: Context) {
    super(ctx, 'mcpController', { namespace: 'mcp' })
    ctx.effect(() => () => { this.lifetime.abort() }, 'mcp-controller.streams')
  }

  /**
   * Read the complete profile view without starting network work.
   * @returns Current desired configuration and redacted live observations.
   */
  @Remote
  snapshot(): McpManagementSnapshot { return this.ctx.mcpManagement.getSnapshot() }

  /**
   * Observe complete replacement snapshots, coalescing updates while the consumer is paused.
   * @param signal - Stream cancellation; controller disposal also closes the stream.
   * @returns Initial state followed by current complete snapshots; no unbounded event backlog.
   */
  @Remote({ mode: 'stream' })
  async *watch(signal: AbortSignal): AsyncIterable<McpManagementSnapshot> {
    const lifetime = AbortSignal.any([signal, this.lifetime.signal])
    lifetime.throwIfAborted()
    let next: McpManagementSnapshot | undefined = this.snapshot()
    let wake: (() => void) | undefined
    const unsubscribe = this.ctx.mcpManagement.subscribe(() => {
      next = this.snapshot()
      wake?.()
    })
    lifetime.addEventListener('abort', unsubscribe, { once: true })
    try {
      while (!lifetime.aborted) {
        if (next !== undefined) {
          const current = next
          next = undefined
          yield current
          continue
        }
        await new Promise<void>((resolve) => {
          const done = (): void => {
            lifetime.removeEventListener('abort', done)
            wake = undefined
            resolve()
          }
          wake = done
          lifetime.addEventListener('abort', done, { once: true })
        })
      }
    } finally {
      lifetime.removeEventListener('abort', unsubscribe)
      unsubscribe()
    }
  }

  /**
   * Save desired configuration independently from connection readiness.
   * @param request - Full desired configuration and editor revision.
   * @returns Durable record identity and current status.
   */
  @Remote
  async save(request: McpSaveRequest): Promise<McpSaveResult> {
    return this.invoke(() => this.ctx.mcpManagement.save(request))
  }

  /**
   * Stop the owned connection before deleting its configuration.
   * @param request - Owned record and expected revision.
   * @returns Durable removal after its child stops.
   */
  @Remote
  async removeServer(request: McpRemoveRequest): Promise<McpManagementSnapshot> {
    return this.invoke(() => this.ctx.mcpManagement.remove(request))
  }

  /**
   * Persist enablement and apply it to the owned connection.
   * @param request - Desired switch and expected revision.
   * @returns Committed desired state and current observed readiness.
   */
  @Remote
  async setEnabled(request: McpSetEnabledRequest): Promise<McpManagementSnapshot> {
    return this.invoke(() => this.ctx.mcpManagement.setEnabled(request))
  }

  /**
   * Replace an enabled connection after confirmed cleanup.
   * @param request - Enabled manager-owned record.
   * @returns New observed attempt after the previous child quiesces.
   */
  @Remote
  async reconnect(request: McpServerRequest): Promise<McpManagementSnapshot> {
    return this.invoke(() => this.ctx.mcpManagement.reconnect(request))
  }

  /**
   * Refresh tools on an initialized owned connection; starts no server and invokes no tool.
   * @param request - Managed record address.
   * @param signal - Cancellation of the tools/list request.
   * @returns The complete profile view after discovery.
   */
  @Remote
  async probe(request: McpServerRequest, signal: AbortSignal): Promise<McpManagementSnapshot> {
    signal.throwIfAborted()
    try { return await this.invoke(() => this.ctx.mcpManagement.probe(request, signal)) } catch (error) {
      signal.throwIfAborted()
      throw error
    }
  }

  private async invoke<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() } catch (error) {
      if (error instanceof McpManagementError) throw new RemoteError(
        `mcp/${error.code}`, 'MCP management request failed', {},
      )
      throw new RemoteError('gateway/internal', 'MCP management request failed', {})
    }
  }
}

export default McpController
