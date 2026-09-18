/** Visible startup sequencing and cancellation through owned work's quiescent completion. */

/** Actual operations reported by profile reconciliation and application startup. */
export type DesktopStartupStage =
  | 'opening' | 'recovering' | 'verifying' | 'extracting' | 'installing'
  | 'checking' | 'cleaning' | 'activating' | 'starting-host' | 'loading-app'

/** Snapshot delivered to the local startup page. */
export type DesktopStartupState =
  | { readonly phase: 'starting'; readonly stage: DesktopStartupStage }
  | { readonly phase: 'ready' }
  | { readonly phase: 'stopping' }
  | { readonly phase: 'error'; readonly message: string; readonly diagnosticFile?: string; readonly canRestart: boolean }

/** Shell operations whose completion belongs to one startup attempt. */
export interface DesktopStartupOperations {
  /** Resolve after the localized startup page is visible and has painted. */
  readonly show: (signal: AbortSignal) => Promise<void>
  /** Resolve only after reconciliation and its worker have exited. */
  readonly prepare: (signal: AbortSignal, report: (stage: DesktopStartupStage) => void) => Promise<void>
  /** Register the Host before awaiting readiness so stop can reach a starting child. */
  readonly startHost: () => Promise<void>
  readonly openApp: () => Promise<void>
  /** Stop and await every owned Host, including one still starting. */
  readonly stopHosts: () => Promise<void>
  readonly diagnose: (error: unknown) => Promise<string | undefined>
  readonly publish: (state: DesktopStartupState) => void
}

/** A startup attempt cannot publish readiness or launch work after cancellation. */
export class DesktopStartup {
  private readonly cancellation = new AbortController()
  private task: Promise<void> | undefined
  private closing: Promise<void> | undefined
  private current: DesktopStartupState = { phase: 'starting', stage: 'opening' }

  constructor(private readonly operations: DesktopStartupOperations) {}

  /** Latest state; the renderer reads this after subscribing to avoid missing initial events. */
  get state(): DesktopStartupState { return this.current }

  /** Show the page before preparing the profile, then connect the application to a ready Host. */
  start(): Promise<void> {
    this.task ??= this.run()
    return this.task
  }

  /** Cancel future work and await reconciliation, child exit, and startup callbacks. */
  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.cancellation.abort(new Error('Desktop startup canceled'))
    this.publish({ phase: 'stopping' })
    this.closing = (async () => {
      const results = await Promise.allSettled([this.operations.stopHosts(), this.task])
      const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
      // A child can have registered just before cancellation; startHost must not outlive this wait.
      try { await this.operations.stopHosts() } catch (error) { failures.push(error) }
      if (failures.length > 0) {
        const error = new AggregateError(failures, 'Desktop shutdown did not complete')
        const diagnosticFile = await this.operations.diagnose(error)
        this.publish({ phase: 'error', message: error.message, canRestart: false, ...(diagnosticFile === undefined ? {} : { diagnosticFile }) })
        this.closing = undefined
        throw error
      }
    })()
    return this.closing
  }

  private publish(state: DesktopStartupState): void {
    this.current = state
    this.operations.publish(state)
  }

  private report = (stage: DesktopStartupStage): void => {
    if (!this.cancellation.signal.aborted) this.publish({ phase: 'starting', stage })
  }

  private async run(): Promise<void> {
    const signal = this.cancellation.signal
    try {
      signal.throwIfAborted()
      await this.operations.show(signal)
      signal.throwIfAborted()
      await this.operations.prepare(signal, this.report)
      signal.throwIfAborted()
      this.report('starting-host')
      await this.operations.startHost()
      signal.throwIfAborted()
      this.report('loading-app')
      await this.operations.openApp()
      signal.throwIfAborted()
      this.publish({ phase: 'ready' })
    } catch (reason) {
      if (signal.aborted) return
      let error = reason
      let canRestart = true
      try { await this.operations.stopHosts() } catch (cleanupError) {
        canRestart = false
        error = new AggregateError([reason, cleanupError], 'Desktop startup and Host cleanup failed')
      }
      const diagnosticFile = await this.operations.diagnose(error)
      if (this.cancellation.signal.aborted) return
      this.publish({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
        canRestart,
        ...(diagnosticFile === undefined ? {} : { diagnosticFile }),
      })
    }
  }
}
