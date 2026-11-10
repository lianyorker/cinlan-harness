import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'

/**
 * Read the client sessions facade off a booted test context.
 *
 * The helper lives at this package's source root so the facade augmentation is
 * the primary declaration in the program that performs the read, keeping the
 * accessor typed against `ISessions` regardless of the consuming program's
 * merge order.
 * @param ctx - booted client context.
 * @returns the sessions facade, or undefined before the client provides it.
 */
export type { ISessions }

export function contextSessions(ctx: ClientContext): ISessions | undefined {
  return ctx.get('sessions')
}
