/** Full committed snapshots with one coalescing slot per slow follower. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-automation'
import type { AutomationFollowFrame, AutomationSnapshot } from './types.ts'
import { automationFailure } from './errors.ts'

/** Owns runtime observation and retires every waiter during Host HMR. */
export class AutomationFeed {
  private readonly followers = new Set<Follower>()
  private closed = false

  /** @param ctx - injected runtime owner and controller lifetime. */
  constructor(private readonly ctx: Context) {
    ctx.effect(() => ctx.automationRuntime.subscribe((snapshot) => {
      for (const follower of this.followers) follower.push(snapshot)
    }), 'automation-controller.runtime')
    ctx.effect(() => () => {
      this.closed = true
      for (const follower of this.followers) follower.close()
      this.followers.clear()
    }, 'automation-controller.followers')
  }

  /** Open a complete baseline followed by coalesced committed snapshots.
   * @param signal - Remote generation cancellation.
   * @returns opening baseline then full replacements.
   */
  async *follow(signal: AbortSignal): AsyncIterable<AutomationFollowFrame> {
    if (signal.aborted || this.closed) return
    const follower = new Follower()
    this.followers.add(follower)
    const close = (): void => { follower.close() }
    signal.addEventListener('abort', close, { once: true })
    try {
      let value: AutomationSnapshot
      try {
        value = this.ctx.automationRuntime.snapshot()
      } catch (error) {
        throw automationFailure(error)
      }
      yield { type: 'baseline', value }
      while (!signal.aborted) {
        const next = await follower.next()
        if (next === undefined) return
        yield { type: 'snapshot', value: next }
      }
    } finally {
      signal.removeEventListener('abort', close)
      this.followers.delete(follower)
      follower.close()
    }
  }
}

class Follower {
  private pending: AutomationSnapshot | undefined
  private wake: (() => void) | undefined
  private closed = false
  private failure: Error | undefined

  push(value: AutomationSnapshot): void {
    if (this.closed) return
    this.pending = value
    this.wake?.()
  }

  fail(error: Error): void {
    this.failure = error
    this.close()
  }

  close(): void {
    this.closed = true
    this.pending = undefined
    this.wake?.()
  }

  async next(): Promise<AutomationSnapshot | undefined> {
    if (!this.closed && this.pending === undefined) {
      await new Promise<void>((resolve) => { this.wake = resolve })
      this.wake = undefined
    }
    if (this.failure !== undefined) throw this.failure
    const value = this.pending
    this.pending = undefined
    return value
  }
}
