/** React-free automation state, journal query and generated Remote commands. */
import { Service, type Context } from '@deepseek-ai/cordis'
import { RemoteSnapshotStream, RemoteStreamCarrierError, isRemoteFailure } from '@deepseek-ai/dsh-api-gateway/client'
import type { ConnectionGenerationState, ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { AutomationRemotes } from './remote.ts'
import type {
  AutomationClientFailure, AutomationClientSnapshot, AutomationDefinition, AutomationDelete, AutomationDraft,
  AutomationFollowFrame, AutomationId, AutomationRun, AutomationRunId, AutomationRunPage, AutomationRunRequest,
  AutomationSchedule, AutomationSnapshot, AutomationSource, AutomationUpdate,
} from '../types.ts'
export type * from '../types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Stable observable source and automation-only commands. */
    automationClient: AutomationClient
  }
}

/** Rejected command carrying a localizable, bounded public failure. */
export class AutomationClientError extends Error {
  /** @param failure - safe public failure fields. */
  constructor(readonly failure: AutomationClientFailure) {
    super(failure.message)
    this.name = 'AutomationClientError'
  }
}

type Baseline = Extract<AutomationFollowFrame, { type: 'baseline' }>
type Replacement = Extract<AutomationFollowFrame, { type: 'snapshot' }>

/** Host-authoritative data; failed commands never fabricate an empty committed view. */
export class AutomationClient extends Service implements AutomationSource {
  static inject = ['remote', 'remote.automation', 'connection']
  /** Stable framework hook input, independent from the Cordis service proxy. */
  readonly source: AutomationSource
  private value: AutomationClientSnapshot = {
    writable: false, availability: 'loading', loading: true, error: null, runtime: null,
    catalog: null, catalogLoading: true, history: null,
  }
  private readonly listeners = new Set<() => void>()
  private readonly remote: AutomationRemotes
  private readonly connection: ConnectionGenerationState
  private readonly control: RemoteSnapshotStream<Baseline, Replacement>
  private generation = 0
  private refreshRequest = 0
  private historyRequest = 0
  private historyLimit = 50
  private historyDirty = false
  private historyRefreshScheduled = false
  private errorRevision = 0
  private frameRevision = 0
  private disposed = false
  private notificationPending = false

  /** @param ctx - generated automation namespace and existing Connection generation owner. */
  constructor(ctx: Context) {
    super(ctx, 'automationClient')
    this.remote = ctx.remote as unknown as AutomationRemotes
    const connection = ctx.get('connection') as ConnectionHandle
    this.connection = connection.generation
    this.value = { ...this.value, writable: connection.isLoopback }
    this.source = { getSnapshot: () => this.getSnapshot(), subscribe: listener => this.subscribe(listener) }
    const stream = this.remote.$stream<AutomationFollowFrame>({
      name: 'Automation state stream',
      open: signal => this.remote.automation.follow(signal),
      ended: () => new RemoteStreamCarrierError('Automation state stream ended'),
      carrierFailed: (error) => { this.fail(error) },
    })
    this.control = new RemoteSnapshotStream<Baseline, Replacement>(stream, {
      name: 'Automation state stream',
      isSnapshot: (frame): frame is Baseline => frame.type === 'baseline',
      replace: (frame) => { this.accept(frame.value) },
      update: (frame) => { this.accept(frame.value) },
      failed: (error) => { this.fail(error) },
    })
    ctx.effect(() => this.connection.subscribe(() => { this.connected() }), 'automation-client.connection')
    ctx.effect(() => async () => {
      this.disposed = true
      this.generation++
      this.listeners.clear()
      await this.control.dispose()
    }, 'automation-client.control')
    this.connected()
    this.control.start()
  }

  /**
   * Read the current automation state and query results.
   * @returns The identity-stable public snapshot.
   */
  getSnapshot(): AutomationClientSnapshot { return this.value }

  /**
   * Observe changes to the public automation snapshot.
   * @param listener - Invalidation callback.
   * @returns An idempotent unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Create a disabled plan through the local Host.
   * @param draft - explicit inputs.
   * @returns the committed disabled definition.
   */
  create(draft: AutomationDraft): Promise<AutomationDefinition> {
    return this.mutate(() => this.remote.automation.create(draft))
  }

  /** Save a complete revision-fenced replacement.
   * @param update - complete replacement.
   * @returns the committed definition.
   */
  update(update: AutomationUpdate): Promise<AutomationDefinition> {
    return this.mutate(() => this.remote.automation.update(update))
  }

  /** Delete an inactive plan.
   * @param request - definition identity and first-edit revision.
   */
  delete(request: AutomationDelete): Promise<void> {
    return this.mutate(() => this.remote.automation.delete(request))
  }

  /** Admit one explicit manual invocation.
   * @param request - retained manual-admission token.
   * @returns the admitted invocation.
   */
  run(request: AutomationRunRequest): Promise<AutomationRun> {
    return this.mutate(() => this.remote.automation.run(request))
  }

  /** Cancel an invocation without changing recurrence.
   * @param runId - admitted invocation to cancel.
   */
  cancel(runId: AutomationRunId): Promise<void> {
    return this.mutate(() => this.remote.automation.cancel({ runId }))
  }

  /** Read one journal page without changing the selected query.
   * @param id - definition identity.
   * @param cursor - exclusive journal cursor.
   * @param limit - bounded page size.
   * @returns committed receipts.
   */
  runs(id: AutomationId, cursor: AutomationRunId | null, limit: number): Promise<AutomationRunPage> {
    return this.command(() => this.remote.automation.runs({ id, cursor, limit }))
  }

  /** Preview a UTC schedule without saving it.
   * @param schedule - minute-precision UTC recurrence.
   * @param afterUtc - exclusive UTC bound.
   * @returns five future timestamps.
   */
  previewSchedule(schedule: AutomationSchedule, afterUtc: number): Promise<number[]> {
    return this.command(() => this.remote.automation.previewSchedule({ schedule, afterUtc }))
  }

  /** Refresh metadata and state independently; a failed read retains the corresponding committed value. */
  async refresh(): Promise<void> {
    if (this.disposed) return
    const generation = this.generation
    const request = ++this.refreshRequest
    const frame = this.frameRevision
    const error = this.errorRevision
    this.publish({ loading: true, catalogLoading: true })
    const current = (): boolean => !this.disposed && generation === this.generation && request === this.refreshRequest
    const results = await Promise.allSettled([
      this.read(() => this.remote.automation.snapshot()).then((runtime) => {
        if (current() && frame === this.frameRevision) this.accept(runtime)
      }),
      this.read(() => this.remote.automation.catalog()).then((catalog) => {
        if (current()) this.publish({ catalog })
      }),
    ])
    if (!current()) return
    const failed = results.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') this.fail(failed.reason)
    else if (error === this.errorRevision) this.publish({ error: null })
    this.publish({ loading: false, catalogLoading: false })
  }

  /** Replace the selected journal query while retaining its data on failure.
   * @param id - selected definition.
   * @param limit - page size.
   * @returns after the selected query settles.
   */
  async loadRuns(id: AutomationId, limit: number = 50): Promise<void> {
    this.historyDirty = false
    this.historyLimit = limit
    const previous = this.value.history
    this.publish({ history: {
      automationId: id, runs: previous !== null && previous.automationId === id ? previous.runs : [],
      nextCursor: previous !== null && previous.automationId === id ? previous.nextCursor : null,
      loading: true, error: previous !== null && previous.automationId === id ? previous.error : null,
    } })
    await this.loadHistory(id, null, false)
  }

  /** Append the next selected journal page; repeated clicks while pending are inert. */
  async loadMoreRuns(): Promise<void> {
    const history = this.value.history
    if (history === null || history.loading || history.nextCursor === null) return
    this.publish({ history: { ...history, loading: true } })
    await this.loadHistory(history.automationId, history.nextCursor, true)
  }

  private async loadHistory(id: AutomationId, cursor: AutomationRunId | null, append: boolean): Promise<void> {
    const request = ++this.historyRequest
    const generation = this.generation
    const current = (): boolean => !this.disposed && request === this.historyRequest && generation === this.generation
    try {
      const page = await this.read(() => this.remote.automation.runs({ id, cursor, limit: this.historyLimit }))
      if (!current()) return
      const previous = append ? this.value.history?.runs ?? [] : []
      const seen = new Set(previous.map(run => run.id))
      this.publish({ history: { automationId: id, runs: [...previous, ...page.runs.filter(run => !seen.has(run.id))],
        nextCursor: page.nextCursor, loading: false, error: null } })
    } catch (error) {
      if (!current() || this.value.history === null) return
      this.publish({ history: { ...this.value.history, loading: false, error: clientFailure(error) } })
    } finally {
      if (current() && this.historyDirty) this.revalidateHistory()
    }
  }

  private connected(): void {
    if (this.disposed) return
    this.generation++
    this.historyDirty = false
    this.control.restart()
    const history = this.value.history
    if (history !== null) this.publish({ history: { ...history, loading: false } })
    if (this.connection.getSnapshot() === undefined) {
      this.publish({ availability: 'unavailable', loading: true, catalogLoading: false })
      return
    }
    void this.refresh()
    if (history !== null) void this.loadRuns(history.automationId, this.historyLimit)
  }

  private accept(runtime: AutomationSnapshot): void {
    if (this.disposed) return
    const previous = this.value.runtime
    this.frameRevision++
    this.publish({ runtime, availability: runtime.status, loading: false })
    if (runtime.status === 'ready' && (previous?.status !== 'ready'
      || previous.profile !== runtime.profile || previous.revision !== runtime.revision)) this.revalidateHistory()
  }

  private revalidateHistory(): void {
    if (this.disposed || this.value.history === null) return
    this.historyDirty = true
    if (this.historyRefreshScheduled) return
    this.historyRefreshScheduled = true
    queueMicrotask(() => {
      this.historyRefreshScheduled = false
      const history = this.value.history
      if (this.disposed || !this.historyDirty || history === null || history.loading) return
      void this.loadRuns(history.automationId, this.historyLimit)
    })
  }

  private async mutate<T>(operation: () => Promise<RemoteResult<T>>): Promise<T> {
    if (!this.value.writable) {
      const error = new AutomationClientError({ code: 'unavailable', message: 'Automation changes require the local Host.' })
      this.fail(error)
      throw error
    }
    return this.command(operation)
  }

  private async command<T>(operation: () => Promise<RemoteResult<T>>): Promise<T> {
    const generation = this.generation
    try {
      return await this.read(operation)
    } catch (error) {
      if (!this.disposed && generation === this.generation) this.fail(error)
      throw new AutomationClientError(clientFailure(error))
    }
  }

  private async read<T>(operation: () => Promise<RemoteResult<T>>): Promise<T> {
    if (this.disposed) throw new AutomationClientError({ code: 'unavailable', message: 'Automation client is unavailable.' })
    const result = await operation()
    if (!result.ok) throw result.error
    return result.value
  }

  private fail(error: unknown): void {
    if (this.disposed) return
    this.errorRevision++
    const failure = clientFailure(error)
    this.publish({ error: failure, loading: false,
      ...failure.code === 'transport' || failure.code === 'unavailable' ? { availability: 'unavailable' as const } : {},
    })
  }

  private publish(patch: Partial<AutomationClientSnapshot>): void {
    if (this.disposed) return
    this.value = { ...this.value, ...patch }
    if (this.notificationPending) return
    this.notificationPending = true
    queueMicrotask(() => {
      this.notificationPending = false
      if (!this.disposed) notifySubscribers(this.listeners, '[automation-client]')
    })
  }
}

function clientFailure(error: unknown): AutomationClientFailure {
  if (error instanceof AutomationClientError) return error.failure
  if (isRemoteFailure(error) && error.code === 'automation/operation-failed') {
    return { code: error.details.code, message: error.message.slice(0, 256) }
  }
  return { code: 'transport', message: 'Automation connection failed.' }
}

export default AutomationClient
