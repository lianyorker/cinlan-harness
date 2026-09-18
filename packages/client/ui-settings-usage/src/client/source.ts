/** React-free query lifetime; only the active request may publish a report. */
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { UsageQueryRequest, UsageQueryResult } from '@deepseek-ai/dsh-api-usage-controller/types'

/** Generated Remote method projected into one cancellable callback. */
export type QueryUsage = (request: UsageQueryRequest, options: { signal: AbortSignal }) => Promise<UsageQueryResult>

/** One query state; loading and failures carry no exportable result. */
export type UsageSnapshot =
  | { readonly status: 'unavailable' | 'idle' | 'loading' | 'error' }
  | { readonly status: 'ready'; readonly result: UsageQueryResult }

/** Owns the last report, request cancellation, and subscriber lifetime. */
export class UsageSource implements ObservableSnapshot<UsageSnapshot> {
  private snapshot: UsageSnapshot = { status: 'unavailable' }
  private readonly listeners = new Set<() => void>()
  private readonly pending = new Set<Promise<void>>()
  private active: AbortController | undefined
  private query: QueryUsage | undefined
  private request: UsageQueryRequest | undefined
  private disposed = false

  /** @returns the same snapshot until a request or availability transition. */
  getSnapshot = (): UsageSnapshot => this.snapshot

  /**
   * Observe committed query state.
   * @param listener - framework invalidation callback.
   * @returns idempotent unsubscribe.
   */
  subscribe = (listener: () => void): (() => void) => {
    if (!this.disposed) this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Attach the injected Remote method and resume an open page's request.
   * @param query - method owned by the current Remote injection lifetime.
   */
  connect(query: QueryUsage): void {
    if (this.disposed) return
    this.query = query
    if (this.request) void this.load(this.request)
    else this.publish({ status: 'idle' })
  }

  /** Publish unavailability immediately and await cancelled Remote work. */
  async disconnect(): Promise<void> {
    this.query = undefined
    this.abort()
    this.publish({ status: 'unavailable' })
    await Promise.all(this.pending)
  }

  /**
   * Replace the current request; late settlements cannot publish.
   * @param request - exact UTC interval and route filters selected by the page.
   * @returns settlement after the result or localized error state is published.
   */
  load = (request: UsageQueryRequest): Promise<void> => {
    if (this.disposed) return Promise.resolve()
    this.abort()
    this.request = request
    const query = this.query
    if (!query) {
      this.publish({ status: 'unavailable' })
      return Promise.resolve()
    }
    const controller = new AbortController()
    this.active = controller
    this.publish({ status: 'loading' })
    const task = this.run(query, request, controller)
    this.pending.add(task)
    void task.then(() => { this.pending.delete(task) })
    return task
  }

  /** Stop page-owned work on unmount or invalid input without losing availability. */
  cancel = (): void => {
    this.request = undefined
    this.abort()
    this.publish({ status: this.query ? 'idle' : 'unavailable' })
  }

  /** Silence subscribers before aborting, then await all owned requests. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.listeners.clear()
    this.request = undefined
    await this.disconnect()
  }

  private abort(): void {
    this.active?.abort()
    this.active = undefined
  }

  private publish(snapshot: UsageSnapshot): void {
    if (this.disposed) return
    this.snapshot = snapshot
    notifySubscribers(this.listeners, '[ui-settings-usage]')
  }

  private async run(query: QueryUsage, request: UsageQueryRequest, controller: AbortController): Promise<void> {
    let result: UsageQueryResult
    try {
      result = await query(request, { signal: controller.signal })
    } catch {
      // Transport and Host failures become locale-owned UI copy; cancelled requests stay silent.
      if (this.active === controller) {
        this.active = undefined
        this.publish({ status: 'error' })
      }
      return
    }
    if (this.active !== controller) return
    this.active = undefined
    this.publish({ status: 'ready', result })
  }
}
