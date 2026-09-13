/** Package-owned relationship invariant for the durable finding event stream. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { applyFindingEvent, cloneFindingFoldState, emptyFindingFoldState } from './fold.ts'
import type { FindingFoldState } from './fold.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-finding'

/** Cordis companion plugin name. */
export const name = 'finding-invariant'
/** Services required by the invariant companion. */
export const inject = ['invariants']

/** Apply one event and attribute a strict replay failure. */
function applyChecked(state: FindingFoldState, event: SessionEvent, fail: InvariantFailure): void {
  try {
    applyFindingEvent(state, event)
  } catch (error) {
    /* v8 ignore next -- the owned strict fold throws Error subclasses only. */
    const message = error instanceof Error ? error.message : String(error)
    fail(`session event ${event.seq} violates the durable finding stream: ${message}`)
  }
}

/** Install an independent incremental fold over every attached Session. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const states = new WeakMap<Session, FindingFoldState>()
  const staged = new WeakMap<SessionEvent, { session: Session; state: FindingFoldState }>()

  const seed = (session: Session): FindingFoldState => {
    const state = emptyFindingFoldState()
    for (const event of session.snapshotEvents()) applyChecked(state, event, fail)
    states.set(session, state)
    return state
  }
  /* v8 ignore next -- every published Session is seeded by list() or session/created. */
  const stateFor = (session: Session): FindingFoldState => states.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    const state = cloneFindingFoldState(stateFor(session))
    applyChecked(state, event, fail)
    staged.set(event, { session, state })
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    const candidate = staged.get(event)
    /* v8 ignore next 2 -- internal/dispatch stages the exact publication arguments. */
    if (candidate === undefined || candidate.session !== session) {
      return fail('session/event reached publication without matching finding-fold validation')
    }
    staged.delete(event)
    states.set(session, candidate.state)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the package invariant companion.
 * @param ctx - Cordis context carrying the invariant registry.
 * @returns The registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
