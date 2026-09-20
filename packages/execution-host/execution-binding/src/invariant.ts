/** Admission invariant for durable execution identity and mounted providers. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from './index.ts'
import { foldExecutionBinding } from './session.ts'

/** Cordis invariant contribution. */
export const name = 'execution-binding-invariant'
/** Invariant ownership registry. */
export const inject = ['invariants']

const install: InvariantInstaller = Object.assign((ctx: Context, fail: (message: string) => never) => {
  ctx.on('agent/created', ({ agent }) => {
    const binding = foldExecutionBinding(agent.session.snapshotEvents())
    if (binding === null) return
    let actual
    try { actual = ctx.executionBindings.executionForAgent(agent) } catch {
      return fail('Session execution selection has no admitted Agent provider world')
    }
    if (JSON.stringify(binding) !== JSON.stringify(actual.binding)) {
      fail('Session execution selection differs from its admitted provider world')
    }
  }, { global: true })
}, { inject: ['executionBindings'] })

/**
 * Register the publication invariant with caller-owned teardown.
 * @param ctx - owning Cordis context.
 * @returns registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-execution-binding', install))
