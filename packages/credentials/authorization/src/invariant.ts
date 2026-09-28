/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-authorization`.
 * @module @deepseek-ai/dsh-authorization/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-authorization'

/** Cordis companion plugin name. */
export const name = 'authorization-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Install the single-flight release contract: `authorization/settled` names a
 * finished attempt, and that exact attempt must have released its key before
 * the event fires. A slot still held by the settled attempt is unrecoverable —
 * every later `begin()` for that key is refused as `ALREADY_IN_FLIGHT` until the
 * process restarts — and it is invisible from the outside, because a wedged key
 * looks exactly like a busy one. A newer attempt is allowed to claim the key
 * while settlement listeners run.
 */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('authorization/settled', (key, _settlement, attemptId) => {
    const authorization = ctx.get('authorization')
    if (authorization === undefined) {
      fail(`authorization/settled for "${key}" emitted without a live authorization service`)
      return
    }
    // A flow withdrawn during its own attempt settles with nothing left to
    // describe, which is the disposer's documented behavior rather than a leak.
    if (authorization.describe(key)?.attemptId === attemptId) {
      fail(`authorization/settled for "${key}" left the key in flight for the settled attempt, wedging every later attempt`)
    }
  })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
