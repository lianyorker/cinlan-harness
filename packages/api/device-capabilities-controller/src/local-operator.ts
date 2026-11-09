/** Require the authenticated local operator for Host desktop operations. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'

/**
 * Reject Remote calls that do not belong to the authenticated browser Peer.
 * @param ctx - Controller context for the current Remote invocation.
 * @returns After confirming the invocation belongs to this Host's operator.
 */
export function requireLocalOperator(ctx: Context): void {
  const invocation = ctx.invocation
  const operator = ctx.get('connection')?.browserPeer
  if (invocation === undefined || operator === undefined || invocation.peer !== operator || invocation.signal.aborted) {
    throw new Error('Host desktop operations require an authenticated local request')
  }
}
