/** Host-owned admission policy shared by session-scoped Ralph tools. */
import { Service, type Context, type Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

declare module '@deepseek-ai/cordis' {
  interface Context {
    ralphPolicy: RalphPolicy
  }
}

/** Live Host policy; enabling availability never starts a workflow. */
export interface Config {
  /** Admit Ralph tools in policy-bound presets; defaults to false. */
  enabled: Volatile<boolean>
  /** Host ceiling applied with each preset ceiling when a call starts. */
  maxRounds: Volatile<number>
}

/** Shared policy provider mounted once at Host scope. */
export default class RalphPolicy extends Service {
  static Config = z.object({
    enabled: z.boolean().default(false).volatile(),
    maxRounds: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(64).volatile(),
  })

  private readonly listeners = new Set<() => void>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'ralphPolicy')
    ctx.on('loader/volatile-update', () => {
      for (const listener of this.listeners) listener()
    })
    ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  }

  /** @returns the accepted Host admission and per-call round ceiling. */
  current(): { enabled: boolean; maxRounds: number } {
    return { enabled: this.config.enabled.get(), maxRounds: this.config.maxRounds.get() }
  }

  /**
   * Observe accepted policy updates for this consumer's lifetime.
   * @param listener - synchronous admission reconciliation; must not throw.
   * @returns disposer removing the observer.
   */
  subscribe(listener: () => void): () => Promise<void> {
    return this.ctx.effect(() => {
      this.listeners.add(listener)
      return () => { this.listeners.delete(listener) }
    })
  }
}
