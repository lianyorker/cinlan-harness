/** Package-owned durable assessment-scope stream invariants. @module @deepseek-ai/dsh-assessment-scope/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import {
  authorizeAssessmentOperation,
  canonicalizeAssessmentGrant,
  isAssessmentGrantSubset,
} from './index.ts'
import type { AssessmentDecision, AssessmentGrant } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-assessment-scope'

/** Cordis companion plugin name. */
export const name = 'assessment-scope-invariant'
/** Services required before the companion can install stream validation. */
export const inject = ['invariants']

interface AssessmentStreamState {
  activeGrant?: AssessmentGrant
  canBind: boolean
  ownBound: boolean
  ownTurnBeforeBind: boolean
  decisionIds: Set<string>
}

function emptyState(): AssessmentStreamState {
  return {
    canBind: true,
    ownBound: false,
    ownTurnBeforeBind: false,
    decisionIds: new Set(),
  }
}

function cloneState(state: AssessmentStreamState): AssessmentStreamState {
  return {
    ...(state.activeGrant === undefined ? {} : { activeGrant: state.activeGrant }),
    canBind: state.canBind,
    ownBound: state.ownBound,
    ownTurnBeforeBind: state.ownTurnBeforeBind,
    decisionIds: new Set(state.decisionIds),
  }
}

function failFrom(error: unknown, fail: InvariantFailure): never {
  /* v8 ignore next -- Session JSON snapshots and local validators only surface Error instances */
  return fail(error instanceof Error ? error.message : String(error))
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function applyEvent(
  session: Session,
  state: AssessmentStreamState,
  event: SessionEvent,
  fail: InvariantFailure,
): void {
  const ownBoundary = session.inheritedEventCount
  const own = event.seq >= ownBoundary
  if (event.type === 'session/end-seed') {
    state.canBind = true
    return
  }
  if (event.type === 'turn/start') {
    if (own && !state.ownBound) state.ownTurnBeforeBind = true
    return
  }
  if (event.type === 'assessment/scope-bound') {
    const payload: unknown = event.data
    if (!exactKeys(payload, ['version', 'source', 'grant'])) {
      return fail('assessment/scope-bound has an invalid payload')
    }
    const binding = payload as { readonly version: unknown; readonly source: unknown; readonly grant: unknown }
    if (binding.version !== 1) return fail('assessment/scope-bound has an invalid payload')
    let grant: AssessmentGrant
    try {
      grant = canonicalizeAssessmentGrant(binding.grant)
    } catch (error) {
      return failFrom(error, fail)
    }
    if (JSON.stringify(grant) !== JSON.stringify(binding.grant)) {
      return fail('assessment/scope-bound grant is not canonical')
    }
    if (!state.canBind) return fail('assessment scope is bound more than once in one seed segment')
    if (own && state.ownBound) return fail('current Session owns more than one assessment/scope-bound event')
    if (own && state.ownTurnBeforeBind) return fail('assessment scope binding follows the Session first turn')
    if (binding.source === 'profile') {
      if (grant.parentGrantId !== undefined) return fail('profile scope binding carries a parentGrantId')
      if (own && session.header.parentSession !== undefined) {
        return fail('child Session uses a profile scope binding instead of a delegated grant')
      }
    } else if (binding.source === 'delegation') {
      if (grant.parentGrantId === undefined) return fail('delegation scope binding omits parentGrantId')
      if (state.activeGrant !== undefined && grant.parentGrantId !== state.activeGrant.grantId) {
        return fail('delegated grant does not reference the preceding bound grant')
      }
      if (state.activeGrant !== undefined && !isAssessmentGrantSubset(state.activeGrant, grant)) {
        return fail('delegated grant expands the preceding bound grant')
      }
      if (own && session.header.parentSession === undefined) {
        return fail('delegation scope binding belongs to a Session without parentSession metadata')
      }
    } else {
      return fail('assessment/scope-bound has an unknown source')
    }
    state.activeGrant = grant
    state.canBind = false
    if (own) state.ownBound = true
    return
  }
  if (event.type !== 'assessment/operation-decided') return
  const payload: unknown = event.data
  if (!exactKeys(payload, ['version', 'decision'])) {
    return fail('assessment/operation-decided has an invalid payload')
  }
  const decided = payload as { readonly version: unknown; readonly decision: unknown }
  if (decided.version !== 1 || decided.decision === null || typeof decided.decision !== 'object'
    || Array.isArray(decided.decision)) return fail('assessment/operation-decided has an invalid payload')
  if (state.activeGrant === undefined) return fail('assessment operation decision precedes any scope binding')
  if (own && !state.ownBound) return fail('current Session decides an operation before owning a delegated binding')
  const decision = decided.decision as AssessmentDecision
  if (decision.grantId !== state.activeGrant.grantId) {
    return fail('assessment operation decision references a grant other than the active binding')
  }
  if (state.decisionIds.has(decision.decisionId)) return fail(`duplicate assessment decision id ${JSON.stringify(decision.decisionId)}`)
  let expected
  try {
    expected = authorizeAssessmentOperation(state.activeGrant, decision.operation)
  } catch (error) {
    return failFrom(error, fail)
  }
  if (JSON.stringify(expected) !== JSON.stringify(decision)) {
    return fail('assessment operation decision does not match the deterministic policy result')
  }
  state.decisionIds.add(decision.decisionId)
}

/** Install incremental validation for loaded and newly appended assessment streams. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const states = new WeakMap<Session, AssessmentStreamState>()
  const staged = new WeakMap<SessionEvent, { session: Session; state: AssessmentStreamState }>()

  const seed = (session: Session): AssessmentStreamState => {
    const state = emptyState()
    for (const event of session.snapshotEvents()) applyEvent(session, state, event, fail)
    states.set(session, state)
    return state
  }
  /* v8 ignore next -- session/event always follows list() or session/created seeding */
  const stateFor = (session: Session): AssessmentStreamState => states.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    const state = cloneState(stateFor(session))
    applyEvent(session, state, event, fail)
    staged.set(event, { session, state })
  }, { global: true })
  ctx.on('session/event', (session, event) => {
    const candidate = staged.get(event)
    /* v8 ignore next 2 -- internal/dispatch stages the exact callback arguments */
    if (candidate === undefined || candidate.session !== session) {
      return fail('session/event reached publication without matching assessment-stream validation')
    }
    staged.delete(event)
    states.set(session, candidate.state)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the assessment-scope invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns Registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
