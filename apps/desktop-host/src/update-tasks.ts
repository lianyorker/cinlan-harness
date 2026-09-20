/** Native Desktop update admission and task inspection. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-jobs'

/** Actions supported by the Desktop update coordinator. */
export type DesktopUpdateTaskAction = 'inspect' | 'lock' | 'unlock'

/**
 * Owns request admission while an update coordinator inspects or drains Host work.
 * API response-body lifetime is intentionally outside admission; long-lived streams
 * cannot block installation after their handler has accepted the request.
 */
export class DesktopUpdateTaskControl {
  private locked = false
  private generation = 0
  private disposed = false
  private changed = Promise.withResolvers<void>()
  private readonly admitted = new Set<Promise<void>>()

  /** @param ctx - Booted profile context used to inspect agent and job services. */
  constructor(private readonly ctx: Context) {
    ctx.effect(() => () => { this.dispose() })
  }

  /** Close admission and invalidate any draining lock. */
  dispose(): void {
    this.disposed = true
    this.invalidate()
  }

  private invalidate(): void {
    this.generation++
    this.changed.resolve()
    this.changed = Promise.withResolvers<void>()
  }

  /**
   * Dispatch an API request while admission is open, returning 503 while locked.
   * @param dispatch - Handler that resolves after accepting work, before response-body consumption.
   * @returns the handler response or admission refusal.
   */
  async dispatch(dispatch: () => Promise<Response>): Promise<Response> {
    if (this.disposed || this.locked) return new Response(null, { status: 503 })
    const done = Promise.withResolvers<void>()
    this.admitted.add(done.promise)
    try { return await dispatch() }
    finally { this.admitted.delete(done.promise); done.resolve() }
  }

  /**
   * Inspect or change update admission and report live agent/job work.
   * @param action - inspection, draining lock, or unlock.
   * @returns whether active tasks remain.
   */
  async run(action: DesktopUpdateTaskAction): Promise<boolean> {
    if (this.disposed) throw new Error('desktop update: Host is stopping')
    const agents = this.ctx.get('agents')
    const jobs = this.ctx.get('jobs')
    if (agents === undefined || jobs === undefined) {
      throw new Error('desktop update: task services are unavailable')
    }
    if (action === 'unlock') {
      this.locked = false
      this.invalidate()
    } else if (action === 'lock') {
      this.locked = true
      this.invalidate()
      const generation = this.generation
      await Promise.race([Promise.all(this.admitted), this.changed.promise])
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Context disposal can run while admitted requests drain.
      if (this.disposed) throw new Error('desktop update: Host is stopping')
      if (generation !== this.generation) throw new Error('desktop update: admission lock was superseded')
    }
    const liveAgents = agents.list()
    return liveAgents.some(agent => agent.status === 'running'
      || agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0)
      || [undefined, ...liveAgents].some(agent => jobs.list(agent)
        .some(job => job.status === 'running' || job.status === 'stopping'))
  }
}

/** Register update admission on the owning Host context. */
export function installDesktopUpdateTaskControl(ctx: Context): DesktopUpdateTaskControl {
  return new DesktopUpdateTaskControl(ctx)
}
