/** Immutable execution selection recorded in the owning Session log. */
import { z } from 'zod'
import { executionSnapshotSchema } from '@deepseek-ai/dsh-execution-host-targets'
import type { ExecutionBinding } from './types.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'

/** Durable input parser; legacy logs without a selection remain local. */
export const executionBindingSchema: z.ZodType<ExecutionBinding> = z.union([
  z.strictObject({ kind: z.literal('local') }), executionSnapshotSchema,
])

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Captured execution deployment; retained by resume and fork without changing Session ownership. */
    'execution/bound': { readonly binding: ExecutionBinding }
  }
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { executionBinding: ExecutionBinding | null }
  interface SessionProjectionMap { executionBinding: ExecutionBinding | null }
}

/** Reject a second differing binding, including events inherited by forks. */
function applyBinding(state: ExecutionBinding | null, event: SessionEvent): ExecutionBinding | null {
  if (event.type !== 'execution/bound') return state
  const next = executionBindingSchema.parse(event.data.binding)
  if (state !== null && JSON.stringify(state) !== JSON.stringify(next)) throw new Error('Session execution binding cannot change')
  return next
}

/**
 * Read the immutable selection from a complete logical event prefix.
 * @param events - complete logical Session event prefix.
 * @returns captured execution binding, or null when no binding event exists.
 */
export function foldExecutionBinding(events: readonly SessionEvent[]): ExecutionBinding | null {
  return events.reduce<ExecutionBinding | null>(applyBinding, null)
}

/** Persisted and client-readable execution location; it never identifies the Session owner. */
export const executionBindingProjection = {
  key: 'executionBinding', stateVersion: 1, stateSchema: executionBindingSchema.nullable(), init: () => null,
  apply: applyBinding, wire: { viewSchema: executionBindingSchema.nullable(), view: state => state },
} satisfies ProjectionDefinition<'executionBinding'>
