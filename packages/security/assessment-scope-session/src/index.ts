/**
 * Session lifecycle Consumer for assessment scope. It binds a root or equal
 * delegated grant before the first step, restores durable bindings after
 * resume or HMR, rejects unbound/expired steps, logs every operation decision,
 * and registers the pure assessment projection when available.
 *
 * @module @deepseek-ai/dsh-assessment-scope-session
 */

import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision, SessionStartSource } from '@deepseek-ai/dsh-agent'
import {
  AssessmentDecisionId,
  AssessmentGrantId,
  AssessmentScopeError,
  isAssessmentGrantSubset,
} from '@deepseek-ai/dsh-assessment-scope'
import { assessmentScopeProjection } from '@deepseek-ai/dsh-assessment-scope'
import type {
  AssessmentDecision,
  AssessmentGrant,
  AssessmentOperation,
  AssessmentScopeBoundEvent,
  AssessmentScopeBoundSource,
} from '@deepseek-ai/dsh-assessment-scope'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'

/** Operation fields supplied by an effect adapter; the runtime inserts audit identity, grant id, and time. */
export type AssessmentSessionOperation = Omit<AssessmentOperation, 'decisionId' | 'grantId' | 'at'>

/** Lifecycle error raised when a Session cannot safely use assessment authority. */
export class AssessmentScopeSessionError extends Error {
  /**
   * @param message - Human-readable failure description.
   * @param code - Stable machine-readable failure code.
   * @param cause - Original provider or durable validation failure.
   */
  constructor(message: string, readonly code: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AssessmentScopeSessionError'
  }
}

interface BoundState {
  readonly kind: 'bound'
  readonly grant: AssessmentGrant
}

interface FailedState {
  readonly kind: 'failed'
  readonly error: AssessmentScopeSessionError
}

type RuntimeState = BoundState | FailedState

function deterministicId(prefix: string, parts: readonly string[]): string {
  const digest = createHash('sha256')
  for (const part of parts) digest.update(part).update('\u0000')
  return `${prefix}-${digest.digest('hex').slice(0, 32)}`
}

function childGrantId(parent: AssessmentGrant, session: Session): ReturnType<typeof AssessmentGrantId> {
  return AssessmentGrantId(deterministicId('child', [parent.grantId, session.id]))
}

function nextDecisionId(session: Session): ReturnType<typeof AssessmentDecisionId> {
  return AssessmentDecisionId(deterministicId('decision', [session.id, String(session.seq)]))
}

function ownBoundary(session: Session): number {
  return session.inheritedEventCount
}

function bindingEvents(session: Session, own: boolean): AssessmentScopeBoundEvent[] {
  const boundary = ownBoundary(session)
  const events: AssessmentScopeBoundEvent[] = []
  for (const event of session.snapshotEvents()) {
    if (event.type !== 'assessment/scope-bound') continue
    if ((event.seq >= boundary) === own) events.push(event.data)
  }
  return events
}

function sessionError(message: string, code: string, cause?: unknown): AssessmentScopeSessionError {
  return new AssessmentScopeSessionError(message, code, cause === undefined ? undefined : { cause })
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    assessmentScopeSessions: AssessmentScopeSessions
  }
}

/** Process-local binding runtime derived exclusively from required Session events. */
export class AssessmentScopeSessions extends Service {
  static inject = ['assessmentScope', 'sessions']

  private readonly states = new WeakMap<Session, RuntimeState>()
  private active = true

  /**
   * @param ctx - Cordis context containing the assessment policy and Session store.
   */
  constructor(ctx: Context) {
    super(ctx, 'assessmentScopeSessions')

    ctx.on('agent/session-start', ({ agent, source }) => {
      try {
        this.activate(agent, source)
      } catch (cause) {
        const error = cause instanceof AssessmentScopeSessionError
          ? cause
          : sessionError(`assessment scope binding failed for Session ${JSON.stringify(agent.session.id)}`, 'ASSESSMENT_SESSION_BIND_FAILED', cause)
        this.states.set(agent.session, { kind: 'failed', error })
        ctx.logger.warn('assessment-scope-session: %s', error.message)
      }
    })

    ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
      const state = this.stateFor(agent.session)
      if (state?.kind !== 'bound') return { kind: 'reject' }
      try {
        const grant = ctx.assessmentScope.restore(state.grant)
        if (ctx.assessmentScope.status(grant, Date.now()) !== 'active') return { kind: 'reject' }
      } catch (cause) {
        this.states.set(agent.session, {
          kind: 'failed',
          error: sessionError(
            `assessment scope revalidation failed for Session ${JSON.stringify(agent.session.id)}`,
            'ASSESSMENT_SESSION_REVALIDATION_FAILED',
            cause,
          ),
        })
        return { kind: 'reject' }
      }
      return next()
    })

    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register(assessmentScopeProjection as any)
    })

    ctx.effect(() => () => {
      this.active = false
    }, 'assessment-scope-session: close runtime lifetime')
  }

  private assertActive(): void {
    if (!this.active) {
      throw sessionError('assessment scope Session runtime is disposed', 'ASSESSMENT_SESSION_DISPOSED')
    }
  }

  private restoreGrant(grant: AssessmentGrant): AssessmentGrant {
    return this.ctx.assessmentScope.restore(grant)
  }

  private restoreBinding(session: Session, binding: AssessmentScopeBoundEvent): AssessmentGrant {
    const grant = this.restoreGrant(binding.grant)
    const parentId = session.header.parentSession
    if (parentId === undefined) {
      if (binding.source !== 'profile' || grant.parentGrantId !== undefined) {
        throw sessionError('root Session carries a delegated assessment scope binding', 'ASSESSMENT_SESSION_BIND_FAILED')
      }
      return grant
    }
    if (binding.source !== 'delegation' || grant.parentGrantId === undefined) {
      throw sessionError('child Session carries a profile assessment scope binding', 'ASSESSMENT_SESSION_BIND_FAILED')
    }
    const parent = this.parentGrant(session, parentId)
    if (grant.parentGrantId !== parent.grantId || !isAssessmentGrantSubset(parent, grant)) {
      throw sessionError('child assessment grant differs from or expands its parent binding', 'ASSESSMENT_SESSION_PARENT_MISMATCH')
    }
    return grant
  }

  private stateFor(session: Session): RuntimeState | undefined {
    const existing = this.states.get(session)
    if (existing !== undefined) return existing
    const own = bindingEvents(session, true)
    if (own.length === 0) return undefined
    if (own.length > 1) {
      const state: FailedState = {
        kind: 'failed',
        error: sessionError('Session owns more than one assessment scope binding', 'ASSESSMENT_SESSION_BIND_FAILED'),
      }
      this.states.set(session, state)
      return state
    }
    try {
      const binding = own[0] as AssessmentScopeBoundEvent
      const grant = this.restoreBinding(session, binding)
      const state: BoundState = { kind: 'bound', grant }
      this.states.set(session, state)
      return state
    } catch (cause) {
      const state: FailedState = {
        kind: 'failed',
        error: sessionError('Session assessment scope binding cannot be restored', 'ASSESSMENT_SESSION_REVALIDATION_FAILED', cause),
      }
      this.states.set(session, state)
      return state
    }
  }

  private parentGrant(
    session: Session,
    parentId: NonNullable<Session['header']['parentSession']>,
  ): AssessmentGrant {
    const inherited = bindingEvents(session, false).at(-1)
    const parentSession = this.ctx.sessions.get(parentId)
    const live = parentSession === undefined ? undefined : this.stateFor(parentSession)
    const liveGrant = live?.kind === 'bound' ? live.grant : undefined
    if (inherited !== undefined && liveGrant !== undefined && inherited.grant.grantId !== liveGrant.grantId) {
      throw sessionError('fork seed binding differs from the live parent binding', 'ASSESSMENT_SESSION_PARENT_MISMATCH')
    }
    const grant = inherited?.grant ?? liveGrant
    if (grant === undefined) {
      throw sessionError('delegated Session has no resolvable parent assessment grant', 'ASSESSMENT_SESSION_PARENT_UNBOUND')
    }
    return this.ctx.assessmentScope.restore(grant)
  }

  private commitBinding(
    session: Session,
    source: AssessmentScopeBoundSource,
    grant: AssessmentGrant,
  ): AssessmentGrant {
    const event = session.append('assessment/scope-bound', { version: 1, source, grant })
    const logged = this.restoreBinding(session, event.data)
    this.states.set(session, { kind: 'bound', grant: logged })
    return logged
  }

  private activate(agent: Agent, source: SessionStartSource): AssessmentGrant {
    this.assertActive()
    const session = agent.session
    const own = bindingEvents(session, true)
    if (own.length > 1) {
      throw sessionError('Session owns more than one assessment scope binding', 'ASSESSMENT_SESSION_BIND_FAILED')
    }
    if (own.length === 1) {
      const binding = own[0] as AssessmentScopeBoundEvent
      const grant = this.restoreBinding(session, binding)
      this.states.set(session, { kind: 'bound', grant })
      return grant
    }
    if (source === 'resume') {
      throw sessionError('resumed Session has no durable assessment scope binding', 'ASSESSMENT_SESSION_UNBOUND')
    }
    if (session.header.parentSession !== undefined) {
      const parent = this.parentGrant(session, session.header.parentSession)
      const child = this.ctx.assessmentScope.deriveChild(parent, { grantId: childGrantId(parent, session) })
      return this.commitBinding(session, 'delegation', child)
    }
    return this.commitBinding(session, 'profile', this.ctx.assessmentScope.rootGrant)
  }

  /**
   * Read the current immutable binding for one Session.
   * @param session - Live or reconstructed Session.
   * @returns Bound grant, or `undefined` when binding is absent or failed.
   */
  get(session: Session): AssessmentGrant | undefined {
    this.assertActive()
    const state = this.stateFor(session)
    return state?.kind === 'bound' ? state.grant : undefined
  }

  /**
   * Require the current immutable binding for one Session.
   * @param session - Session whose authority is required.
   * @returns Revalidated bound grant.
   * @throws {@link AssessmentScopeSessionError} when binding is absent, failed, or outside the provider root.
   */
  require(session: Session): AssessmentGrant {
    this.assertActive()
    const state = this.stateFor(session)
    if (state?.kind === 'failed') throw state.error
    if (state === undefined) {
      throw sessionError('Session has no assessment scope binding', 'ASSESSMENT_SESSION_UNBOUND')
    }
    try {
      return this.ctx.assessmentScope.restore(state.grant)
    } catch (cause) {
      throw sessionError('Session assessment scope binding cannot be revalidated', 'ASSESSMENT_SESSION_REVALIDATION_FAILED', cause)
    }
  }

  /**
   * Decide and durably log one operation before its caller may perform an effect.
   * @param session - Session whose binding supplies the grant id.
   * @param operation - Complete operation except the Session-owned audit identity, grant id, and decision time.
   * @returns The exact frozen decision snapshot that entered the Session log.
   */
  authorize(session: Session, operation: AssessmentSessionOperation): AssessmentDecision {
    const grant = this.require(session)
    const decisionId = nextDecisionId(session)
    const at = Date.now()
    const decision = this.ctx.assessmentScope.authorize(grant, {
      ...operation,
      decisionId,
      grantId: grant.grantId,
      at,
    })
    const event = session.append('assessment/operation-decided', { version: 1, decision })
    return event.data.decision
  }
}

export { AssessmentScopeError }
export default AssessmentScopeSessions
