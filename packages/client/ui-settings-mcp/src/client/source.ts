/** Apply-owned MCP Remote readback and cancellable command lifetimes. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  McpManagementSnapshot, McpManagementErrorCode, McpManagedServerView, McpSaveRequest,
  McpRemoveRequest, McpSetEnabledRequest, McpServerRequest,
} from '@deepseek-ai/dsh-api-mcp-controller/types'

/** Narrow generated namespace consumed by the settings source. */
export type McpRemote = Pick<Context['remote']['mcp'], 'snapshot' | 'watch' | 'save' | 'removeServer' | 'setEnabled' | 'reconnect' | 'probe'>
/** UI failures contain only fixed safe identifiers. */
export type McpUiError = McpManagementErrorCode | 'unavailable' | 'cancelled'
/** Stable readback value delivered only through the registration hooks compartment. */
export interface McpReadback {
  status: 'loading' | 'ready' | 'offline' | 'error'
  snapshot: McpManagementSnapshot | null
  pending: boolean
  readError: McpUiError | null
  actionError: McpUiError | null
}

function errorCode(code: unknown): McpUiError {
  switch (code) {
    case 'mcp/conflict': return 'conflict'
    case 'mcp/invalid-config': return 'invalid-config'
    case 'mcp/not-found': return 'not-found'
    case 'mcp/disabled': return 'disabled'
    case 'mcp/not-ready': return 'not-ready'
    case 'mcp/storage-failed': return 'storage-failed'
    case 'mcp/stopped': return 'stopped'
    case 'mcp/probe-failed': return 'probe-failed'
    case 'mcp/close-failed': return 'close-failed'
    default: return 'unavailable'
  }
}

/**
 * Whether a managed row may request a tools refresh.
 * @param row - current Host view.
 * @returns the UI's conservative admission decision; Host checks again.
 */
export function canRefreshTools(row: McpManagedServerView): boolean {
  return row.record.enabled && !row.applying
    && (row.observed.phase === 'ready' || row.observed.phase === 'error')
}

/** One plugin-owned source; remote snapshots never enter the interaction store. */
export class McpSettingsSource {
  /** Stable readback source; the renderer binds it to the useMcp seat. */
  readonly state = createSnapshotStore<McpReadback>({
    status: 'offline', snapshot: null, pending: false, readError: null, actionError: null,
  })
  private controller: AbortController | undefined
  private generation: number | undefined
  private version = 0
  private readonly tasks = new Set<Promise<unknown>>()

  /**
   * @param remote - generated MCP namespace from the injecting context.
   */
  constructor(private readonly remote: McpRemote) {}

  /**
   * Replace the connection lifetime and cancel its discovery stream.
   * @param generation - usable connection identity, or undefined on loss.
   */
  connect(generation: number | undefined): void {
    if (generation === this.generation) return
    this.generation = generation
    this.restart()
  }

  /** Retry readback on the current usable connection; an open draft keeps its revision. */
  restart(): void {
    this.controller?.abort()
    this.controller = undefined
    const previous = this.state.getSnapshot()
    this.state.set({ ...previous, status: this.generation === undefined ? 'offline' : 'loading',
      pending: false, readError: null, actionError: previous.pending ? 'cancelled' : previous.actionError })
    if (this.generation === undefined) return
    const controller = new AbortController()
    this.controller = controller
    const version = this.version
    void this.track(this.load(controller, version))
    void this.track(this.watch(controller))
  }

  private track<T>(task: Promise<T>): Promise<T> {
    this.tasks.add(task)
    void task.then(() => { this.tasks.delete(task) })
    return task
  }

  private current(controller: AbortController): boolean {
    return this.controller === controller && !controller.signal.aborted
  }

  private publish(snapshot: McpManagementSnapshot, version?: number): void {
    const state = this.state.getSnapshot()
    const existing = state.snapshot
    if (state.status !== 'loading' && existing?.profile === snapshot.profile && (snapshot.revision < existing.revision
      || (version !== undefined && version !== this.version && snapshot.revision === existing.revision))) return
    this.version += 1
    this.state.set({ ...state, snapshot, status: 'ready', readError: null })
  }

  private async load(controller: AbortController, version: number): Promise<void> {
    try {
      const result = await this.remote.snapshot()
      if (!this.current(controller) || version !== this.version) return
      if (result.ok) this.publish(result.value)
      else this.failRead(errorCode(result.error.code))
    } catch {
      // Transport exceptions contain no approved product copy.
      if (this.current(controller) && version === this.version) this.failRead('unavailable')
    }
  }

  private async watch(controller: AbortController): Promise<void> {
    try {
      for await (const snapshot of this.remote.watch(controller.signal)) {
        if (!this.current(controller)) return
        this.publish(snapshot)
      }
      if (this.current(controller)) this.failRead('unavailable')
    } catch (error) {
      // Stream failures throw; only allowlisted codes can select visible copy.
      if (this.current(controller)) this.failRead(errorCode((error as { code?: unknown } | null | undefined)?.code))
    }
  }

  private failRead(error: McpUiError): void {
    this.version += 1
    this.state.set({ ...this.state.getSnapshot(), status: 'error', readError: error })
  }

  /** Report parser rejection without sending malformed desired configuration. */
  invalidDraft(): void {
    this.state.set({ ...this.state.getSnapshot(), actionError: 'invalid-config' })
  }

  private async command<T>(
    operation: (signal: AbortSignal) => Promise<RemoteResult<T>>,
    snapshot: (value: T) => McpManagementSnapshot,
  ): Promise<boolean> {
    const controller = this.controller
    const previous = this.state.getSnapshot()
    if (previous.pending) return false
    if (controller === undefined || !this.current(controller) || previous.status !== 'ready') {
      this.state.set({ ...previous, actionError: 'unavailable' })
      return false
    }
    const version = this.version
    this.state.set({ ...previous, pending: true, actionError: null })
    try {
      const result = await operation(controller.signal)
      if (!this.current(controller)) return false
      if (!result.ok) {
        this.state.set({ ...this.state.getSnapshot(), actionError: errorCode(result.error.code) })
        return false
      }
      this.publish(snapshot(result.value), version)
      return true
    } catch {
      // Never render exception messages, including transport and credential diagnostics.
      if (this.current(controller)) this.state.set({ ...this.state.getSnapshot(), actionError: 'unavailable' })
      return false
    } finally {
      if (this.current(controller)) this.state.set({ ...this.state.getSnapshot(), pending: false })
    }
  }

  /**
   * Save desired configuration with the draft's opening revision.
   * @param request - validated draft.
   * @returns true only on an accepted Remote result in this connection lifetime.
   */
  save(request: McpSaveRequest): Promise<boolean> {
    return this.track(this.command(() => this.remote.save(request), value => value.snapshot))
  }
  /**
   * Delete a saved record.
   * @param request - identity and confirmation revision.
   * @returns whether the Host accepted the removal.
   */
  remove(request: McpRemoveRequest): Promise<boolean> {
    return this.track(this.command(() => this.remote.removeServer(request), value => value))
  }
  /**
   * Persist a desired switch without predicting connection readiness.
   * @param request - saved identity and revision.
   * @returns whether the Host accepted the switch.
   */
  setEnabled(request: McpSetEnabledRequest): Promise<boolean> {
    return this.track(this.command(() => this.remote.setEnabled(request), value => value))
  }
  /**
   * Reconnect an enabled owned record.
   * @param request - managed identity.
   * @returns whether the Host accepted the operation.
   */
  reconnect(request: McpServerRequest): Promise<boolean> {
    return this.track(this.command(() => this.remote.reconnect(request), value => value))
  }
  /**
   * Refresh tools/list on an active connection without invoking tools.
   * @param request - managed identity.
   * @returns whether discovery succeeded.
   */
  probe(request: McpServerRequest): Promise<boolean> {
    return this.track(this.command(signal => this.remote.probe(request, signal), value => value))
  }
  /**
   * Abort readers and discovery, then await all owned completions.
   * @returns quiescent disposal.
   */
  async dispose(): Promise<void> {
    this.generation = undefined
    this.controller?.abort()
    this.controller = undefined
    await Promise.all(this.tasks)
  }
}
