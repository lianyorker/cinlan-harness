/**
 * Service Definition for the authorization capability seam (`ctx.authorization`):
 * obtaining a credential nobody can supply from configuration alone, because
 * getting it requires a conversation with the human — open this page, paste
 * that code, pick an account.
 *
 * The seam owns the conversation and the lifecycle; it never owns the protocol.
 * A plugin that knows how to obtain its own credential registers a flow keyed
 * by the `CredentialKey` that flow writes, and the flow talks to whatever
 * surface started it through one neutral vocabulary of notices and prompts. So
 * a second authorization protocol arrives as another flow rather than as
 * another seam, and a surface that renders one flow renders all of them.
 *
 * ```ts
 * const dispose = ctx.authorization.registerFlow({
 *   key: credentialKey('llm-pi-ai', 'openai-codex'),
 *   label: 'ChatGPT (Codex)',
 *   methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
 *   async run(session) {
 *     session.notify({ message: 'Continue in your browser', url })
 *     await commitThroughCredentials(await exchange(session.signal))
 *     session.commit()
 *   },
 * })
 * ```
 *
 * @module @deepseek-ai/dsh-authorization
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { Context, Service } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import { HarnessError } from '@deepseek-ai/dsh-llm'

import type {
  AuthorizationAttemptId, AuthorizationEntry, AuthorizationMethod, AuthorizationNotice, AuthorizationOutcome,
  AuthorizationPrompt, AuthorizationSettlement,
} from './types.ts'

export type {
  AuthorizationAttemptId, AuthorizationEntry, AuthorizationMethod, AuthorizationNotice, AuthorizationOutcome,
  AuthorizationPrompt, AuthorizationPromptAutocomplete, AuthorizationPromptOption, AuthorizationSettlement,
  AuthorizationStatus,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    authorization: AuthorizationService
  }

  interface Events {
    /**
     * One authorization attempt has finished and released its key. Fires for
     * every terminal outcome, failures included, so a surface watching a key it
     * did not start (a second browser tab) learns the attempt is over.
     * @mode emit
     * @param key - the credential record the finished attempt was authorizing.
     * @param settlement - how it ended, including the `failed` case its caller sees as a thrown error.
     * @param attemptId - the identity of the attempt that released the key.
     */
    'authorization/settled'(
      key: CredentialKey, settlement: AuthorizationSettlement, attemptId: AuthorizationAttemptId): void
  }
}

/** Stable error taxonomy for authorization failures. */
export class AuthorizationError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'AuthorizationError'
  }
}

/**
 * The rejection an {@link AuthorizationInteraction.prompt} uses to say the
 * human declined — dismissed the question, chose not to answer — rather than
 * that the surface broke. An attempt whose flow fails after a prompt was
 * declined settles as `cancelled`, the same outcome as a withdrawn signal,
 * because the human saying no is a refusal, not a breakage. Only a human's
 * "no" may reject with this class: a prompt withdrawn by its own `signal` (a
 * flow retiring the losing question of a race) must reject with something
 * else, or a later genuine failure would be misread as a decline.
 */
export class AuthorizationDeclinedError extends AuthorizationError {
  constructor(message = 'the authorization prompt was declined') {
    super(message, 'DECLINED')
    this.name = 'AuthorizationDeclinedError'
  }
}

/**
 * What a running flow is given to talk to the human. Every member is scoped to
 * one attempt: the flow neither knows nor chooses which surface is listening.
 */
export interface AuthorizationSession {
  /** The method id the caller picked, always one this flow declared. */
  readonly method: string
  /** Aborted when the caller withdraws or `cancel()` is called for this key. */
  readonly signal: AbortSignal
  /**
   * Report progress, or tell the human what to do next. Fire-and-forget: a
   * surface that cannot render a notice must not stall the flow.
   * @param notice - the message, and any page or code it refers to.
   */
  notify(notice: AuthorizationNotice): void
  /**
   * Ask the human a question the flow cannot answer for itself.
   * @param prompt - what to ask, and how it should be presented.
   * @returns what the human typed, or the chosen option's id.
   * @throws when the human declines, or the prompt's own signal withdraws it.
   */
  prompt(prompt: AuthorizationPrompt): Promise<string>
  /**
   * Record that this flow committed its credential through the credentials seam.
   * The target-key record update must already be observed in this flow's
   * asynchronous execution context; the service then confirms the record after
   * the flow resolves.
   * @throws {AuthorizationError} code `NOT_COMMITTED` when no target-key write
   *   was observed, or when the attempt has already been withdrawn.
   */
  commit(): void
}

/**
 * A plugin's knowledge of how to obtain one credential. The flow owns the
 * write: it calls `session.commit()` after the record for `key` is committed
 * through `ctx.credentials` during that run. The seam requires an observed
 * target-key update in that flow's asynchronous context, then reads the record
 * after the flow resolves before reporting success. Committing inside the flow
 * lets a library that persists through its own store adapter (pi-ai's
 * `Models.login()`) stay the single writer instead of being copied back out and
 * written twice.
 */
export interface AuthorizationFlow {
  /** The credential record this flow writes. Its scope names the owning plugin. */
  readonly key: CredentialKey
  /** User-facing name of what is being authorized. */
  readonly label: string
  /**
   * The methods offered, most preferred first; a caller naming none gets the
   * first. Typed non-empty because a flow with nothing to run is a flow that
   * cannot be begun, and the type says so at the one place flows are written.
   */
  readonly methods: readonly [AuthorizationMethod, ...AuthorizationMethod[]]
  /**
   * Wait for this flow to settle after caller cancellation before returning.
   * Set this for flows that perform bounded remote compensation whose failure
   * must reach the initiating surface; omitted flows retain prompt cancellation
   * while their runner keeps the key in flight until it settles.
   */
  readonly awaitCancellation?: boolean
  /**
   * Run one attempt to obtain and commit the credential.
   * @param session - the chosen method, the cancellation signal, and the interaction callbacks.
   * @returns after the flow has written its target record and called `commit()`.
   * @throws when the attempt fails or the human declines.
   */
  run(session: AuthorizationSession): Promise<void>
}

/**
 * The surface half of one attempt. Supplied with the request rather than
 * registered, because the caller that starts an authorization is the one that
 * can talk to the human about it: prompts reach exactly the page that asked,
 * and a headless caller supplies an interaction that declines.
 */
export interface AuthorizationInteraction {
  /**
   * Render a notice from the running flow.
   * @param notice - the message, and any page or code it refers to.
   */
  notify(notice: AuthorizationNotice): void
  /**
   * Put a question to the human and wait.
   * @param prompt - what to ask, and how it should be presented.
   * @returns the typed text, or the chosen option's id.
   * @throws {AuthorizationDeclinedError} when the human declines; any other
   *   rejection reads as the surface failing, not as an answer.
   */
  prompt(prompt: AuthorizationPrompt): Promise<string>
}

/** One request to authorize a key. */
export interface AuthorizationRequest {
  /** The credential record to authorize; a flow must be registered for it. */
  key: CredentialKey
  /** Which of the flow's methods to run. Defaults to the flow's first. */
  method?: string
  /** The surface that will render this attempt's notices and prompts. */
  interaction: AuthorizationInteraction
  /** Withdraws the whole attempt. */
  signal?: AbortSignal
}

/** One attempt in flight, with the handle that withdraws it. */
interface InFlight {
  readonly id: AuthorizationAttemptId
  readonly controller: AbortController
}

/** Caller outcome plus a flow lifetime that outlasted cancellation, when present. */
interface AttemptResult {
  readonly outcome: AuthorizationOutcome
  readonly completion?: Promise<void>
}

function isAbortFailure(error: unknown, signal: AbortSignal): boolean {
  if (error === signal.reason) return true
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as { name?: unknown; code?: unknown }
  return candidate.name === 'AbortError' || candidate.code === 'ABORT_ERR'
}

/** Record-write observation inherited only by work started from one flow runner. */
interface AttemptWriteObservation {
  readonly key: CredentialKey
  written: boolean
}

/**
 * `ctx.authorization`: a registry of credential-obtaining flows, one attempt at
 * a time per key.
 */
export class AuthorizationService extends Service {
  /** The commit receipt and post-run record read make the credential store required. */
  static inject = ['credentials']

  private readonly flows = new Map<CredentialKey, AuthorizationFlow>()
  private readonly running = new Map<CredentialKey, InFlight>()
  private readonly subscribers = new Set<() => unknown>()
  private readonly writeObservations = new AsyncLocalStorage<AttemptWriteObservation>()
  private attemptSequence = 0
  private readonly reservations = new Map<CredentialKey, symbol>()

  constructor(ctx: Context) {
    super(ctx, 'authorization')
    ctx.on('credentials/record-updated', (key) => {
      const observation = this.writeObservations.getStore()
      if (observation?.key === key) observation.written = true
    })
  }

  /**
   * Offer a way to obtain one credential. One flow per key: two plugins
   * claiming the same key would each write a record in their own format, and
   * whichever ran last would leave the other reading a payload it cannot parse.
   *
   * @param flow - the key it writes, its label, its methods, and its runner.
   * @returns Disposer that withdraws this flow.
   * @throws {AuthorizationError} code `DUPLICATE_FLOW` when the key is already claimed.
   */
  registerFlow(flow: AuthorizationFlow): () => void {
    const dispose = this.ctx.effect(function* (this: AuthorizationService) {
      if (this.flows.has(flow.key)) {
        throw new AuthorizationError(
          `an authorization flow for "${flow.key}" is already registered`, 'DUPLICATE_FLOW')
      }
      this.flows.set(flow.key, flow)
      this.changed()
      yield () => {
        this.flows.delete(flow.key)
        // A flow leaving mid-attempt takes its attempt with it: the runner
        // belongs to a plugin that is going away, so letting it keep prompting
        // would outlive the fiber that can answer for it.
        this.running.get(flow.key)?.controller.abort()
        this.changed()
      }
    }.bind(this), 'authorization.registerFlow()')
    return () => void dispose()
  }

  /**
   * Observe flow registration and in-flight changes. Credential commits are
   * reported by the flow's attempt-owned {@link AuthorizationSession.commit}
   * receipt; subscriber failures are contained.
   * @param subscriber - callback that re-reads {@link list} or {@link describe}.
   * @returns disposer that removes the callback.
   */
  subscribe(subscriber: () => unknown): () => void {
    this.subscribers.add(subscriber)
    return () => { this.subscribers.delete(subscriber) }
  }

  /**
   * Every registered flow, for a surface listing what can be authorized.
   * @returns one entry per flow, in registration order.
   */
  list(): readonly AuthorizationEntry[] {
    return [...this.flows.values()].map(flow => this.entry(flow))
  }

  /**
   * One registered flow.
   * @param key - the credential record to ask about.
   * @returns the entry, or undefined when no flow claims that key.
   */
  describe(key: CredentialKey): AuthorizationEntry | undefined {
    const flow = this.flows.get(key)
    return flow === undefined ? undefined : this.entry(flow)
  }

  /** The public view of one registered flow. */
  private entry(flow: AuthorizationFlow): AuthorizationEntry {
    const running = this.running.get(flow.key)
    return {
      key: flow.key,
      label: flow.label,
      methods: flow.methods,
      inFlight: running !== undefined,
      ...running === undefined ? {} : { attemptId: running.id },
    }
  }

  /**
   * Run one local credential operation without allowing authorization for the same key to start.
   * The reservation is released after the callback settles, including rejection.
   * @param key - the credential record to reserve.
   * @param operation - the local operation protected by the reservation.
   * @returns the callback result.
   * @throws {AuthorizationError} code `ALREADY_IN_FLIGHT` when authorization or another operation owns the key.
   */
  async withExclusiveKey<T>(key: CredentialKey, operation: () => Promise<T>): Promise<T> {
    if (this.running.has(key) || this.reservations.has(key)) {
      throw new AuthorizationError(
        `an authorization attempt for "${key}" is already running`, 'ALREADY_IN_FLIGHT')
    }
    const token = Symbol(key)
    this.reservations.set(key, token)
    try {
      return await operation()
    } finally {
      if (this.reservations.get(key) === token) this.reservations.delete(key)
    }
  }

  /**
   * Withdraw the attempt running for a key, if any. Separate from the
   * request's own signal because a request/response transport answers a Cancel
   * button on a second call, with no handle on the first one's signal.
   * @param key - the credential record whose attempt should stop.
   */
  cancel(key: CredentialKey): void {
    this.running.get(key)?.controller.abort()
  }

  /**
   * Run one attempt to authorize a key, and report how it ended.
   *
   * One attempt per key at a time. A second caller is refused rather than
   * joined: the two would be prompting different humans through the same flow,
   * and the second would answer questions the first was asked.
   *
   * @param request - the key, the method, the surface, and the cancel signal.
   * @returns `authorized` once the flow's target-key write and commit receipt
   *   are confirmed and the record remains present, or `cancelled` when the
   *   human declined or the caller withdrew. Withdrawal returns promptly for
   *   flows without {@link AuthorizationFlow.awaitCancellation}, which keep the
   *   key in flight until their runner settles; a flow declaring
   *   `awaitCancellation` keeps this call pending until its bounded remote
   *   compensation settles, and a compensation failure reaches the caller as a
   *   thrown error.
   * @throws {AuthorizationError} code `NO_FLOW` when nothing claims the key,
   *   `UNKNOWN_METHOD` when the named method is not one the flow offers,
   *   `ALREADY_IN_FLIGHT` when an attempt is already running for the key, or
   *   `NOT_COMMITTED` when the flow did not produce an observed target-key write,
   *   commit receipt, or present record during the attempt.
   */
  async begin(request: AuthorizationRequest): Promise<AuthorizationOutcome> {
    const { key } = request
    const flow = this.flows.get(key)
    if (flow === undefined) {
      throw new AuthorizationError(`no authorization flow is registered for "${key}"`, 'NO_FLOW')
    }
    const method = request.method ?? flow.methods[0].id
    if (!flow.methods.some(candidate => candidate.id === method)) {
      throw new AuthorizationError(
        `authorization flow for "${key}" offers no method "${method}"`, 'UNKNOWN_METHOD')
    }
    if (this.running.has(key) || this.reservations.has(key)) {
      throw new AuthorizationError(
        `an authorization attempt for "${key}" is already running`, 'ALREADY_IN_FLIGHT')
    }
    // Withdrawn before it began: never claim the slot and never run the flow.
    // Handing an aborted signal to `run()` would rely on every flow checking it
    // before its first await, and one that does not would hang holding the key.
    // Validation still runs first, so a caller naming a key or method that does
    // not exist hears about it whether or not it also gave up.
    if (request.signal?.aborted === true) return { status: 'cancelled' }
    const controller = new AbortController()
    const withdraw = (): void => { controller.abort(request.signal?.reason) }
    request.signal?.addEventListener('abort', withdraw, { once: true })
    const attemptId = brandString<AuthorizationAttemptId>(String(++this.attemptSequence))
    this.running.set(key, { id: attemptId, controller })
    this.changed()
    let settlement: AuthorizationSettlement = 'failed'
    let completion: Promise<void> | undefined
    try {
      const result = await this.attempt(flow, method, controller.signal, request.interaction)
      settlement = result.outcome.status
      completion = result.completion
      return result.outcome
    } finally {
      request.signal?.removeEventListener('abort', withdraw)
      if (completion === undefined) {
        this.release(key, attemptId, settlement)
      } else {
        void completion.then(() => {
          try {
            this.release(key, attemptId, settlement)
          } catch (error) {
            // The caller already received cancellation, so a late invariant
            // failure has no promise left to reject. Keep it visible without
            // creating an unhandled rejection.
            this.ctx.logger.error('authorization: a withdrawn attempt failed while releasing its key')
            this.ctx.logger.error(error)
          }
        })
      }
    }
  }

  /** Release one exact attempt, publish its registry transition, then report settlement. */
  private release(
    key: CredentialKey, attemptId: AuthorizationAttemptId, settlement: AuthorizationSettlement,
  ): void {
    if (this.running.get(key)?.id === attemptId) {
      this.running.delete(key)
      this.changed()
    }
    // Release the slot before settlement listeners run, so a listener can start
    // a replacement without being refused by the attempt that just finished.
    // The event still names an attempt whose flow was replaced or unregistered;
    // its identity lets listeners distinguish that event from the current owner.
    this.settle(key, settlement, attemptId)
  }

  /** Notify registry observers without letting one broken surface block another. */
  private changed(): void {
    for (const subscriber of [...this.subscribers]) {
      try {
        const returned: unknown = subscriber()
        if (returned != null && typeof (returned as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(returned as PromiseLike<unknown>).then(
            undefined, (error: unknown) => { this.warnSubscriberFailure(error) },
          )
        }
      } catch (error) {
        this.warnSubscriberFailure(error)
      }
    }
  }

  /** Contain one synchronous or asynchronous registry subscriber failure. */
  private warnSubscriberFailure(error: unknown): void {
    this.ctx.logger.warn('authorization: a registry subscriber failed')
    this.ctx.logger.warn(error)
  }

  /* jscpd:ignore-start -- deliberate symmetry with the credentials seam's
     commit fan-out (`CredentialProvider`): the contained-dispatch shape is the
     reviewed listener-lifecycle contract, and extracting it would couple the
     two seams' event semantics. */
  /**
   * Fan `authorization/settled` out with contained listener failures: every
   * listener runs, and a sync throw or async rejection is logged without
   * changing the finished attempt's own outcome — except `INVARIANT`-coded
   * failures, which rethrow after every listener ran. The attempt is already
   * over and its key released when this fires, so a broken watcher (that
   * second browser tab) can never turn the caller's settled result into a
   * failure of its own.
   */
  private settle(
    key: CredentialKey, settlement: AuthorizationSettlement, attemptId: AuthorizationAttemptId,
  ): void {
    let invariantFailure: unknown
    const args = ['authorization/settled', key, settlement, attemptId]
    for (const listener of this.ctx.events.dispatch('emit', args) as Array<(...listenerArgs: unknown[]) => unknown>) {
      try {
        const returned = listener(key, settlement, attemptId)
        if (returned != null && typeof (returned as PromiseLike<unknown>).then === 'function') {
          void Promise.resolve(returned as PromiseLike<unknown>).then(undefined, (error: unknown) => {
            this.warnSettledListenerFailure(key, error)
          })
        }
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === 'INVARIANT') {
          invariantFailure ??= error
          continue
        }
        this.warnSettledListenerFailure(key, error)
      }
    }
    if (invariantFailure !== undefined) throw invariantFailure as Error
  }
  /* jscpd:ignore-end */

  /** Contained-listener diagnostic shared by the sync and async failure paths. */
  private warnSettledListenerFailure(key: CredentialKey, error: unknown): void {
    this.ctx.logger.warn('authorization: an authorization/settled listener for "%s" failed', key)
    this.ctx.logger.warn(error)
  }

  /** Run the flow, then hold it to its half of the commit contract. */
  private async attempt(
    flow: AuthorizationFlow,
    method: string,
    signal: AbortSignal,
    interaction: AuthorizationInteraction,
  ): Promise<AttemptResult> {
    const withdrawn = new Promise<'withdrawn'>((resolve) => {
      // `begin()` returns before claiming the key when its caller has already
      // withdrawn, so this signal cannot already be aborted here.
      signal.addEventListener('abort', () => { resolve('withdrawn') }, { once: true })
    })
    // Closure writes stay on this object so their values remain visible after
    // the awaited flow and prompt callbacks settle. The write observation is
    // inherited only by work started from this runner, so an unrelated writer
    // cannot satisfy this attempt by emitting the same-key event.
    const observed = { declined: false, committed: false }
    const writeObservation: AttemptWriteObservation = { key: flow.key, written: false }
    const running = this.writeObservations.run(writeObservation, async (): Promise<void> => {
      await flow.run({
        method,
        signal,
        notify: (notice) => {
          try {
            interaction.notify(notice)
          } catch (error) {
            // Fire-and-forget is held at the seam: a surface that cannot
            // render a notice (a page whose connection just closed) loses the
            // notice, never the attempt.
            this.ctx.logger.warn('authorization: the interaction surface failed to render a notice')
            this.ctx.logger.warn(error)
          }
        },
        prompt: prompt => interaction.prompt(prompt).catch((error: unknown) => {
          if (error instanceof AuthorizationDeclinedError) observed.declined = true
          throw error
        }),
        commit: () => {
          signal.throwIfAborted()
          if (!writeObservation.written) {
            throw new AuthorizationError(
              `authorization flow for "${flow.key}" called commit before writing its credential record`,
              'NOT_COMMITTED')
          }
          observed.committed = true
        },
      })
      if (!observed.committed || !writeObservation.written) {
        throw new AuthorizationError(
          `authorization flow for "${flow.key}" resolved without committing a credential record in this attempt`,
          'NOT_COMMITTED')
      }
      const stored = await this.ctx.credentials.readRecord(flow.key)
      if (stored === undefined) {
        throw new AuthorizationError(
          `authorization flow for "${flow.key}" deleted its credential record instead of committing one`,
          'NOT_COMMITTED')
      }
    })
    try {
      if (await Promise.race([running.then(() => 'ran' as const), withdrawn]) === 'withdrawn') {
        if (flow.awaitCancellation === true) {
          try {
            await running
          } catch (error) {
            if (!isAbortFailure(error, signal) && !observed.declined) throw error
          }
          return { outcome: { status: 'cancelled' } }
        }
        const completion = running.then(
          () => undefined,
          () => { this.ctx.logger.debug('authorization: withdrawn flow failed after the fact') },
        )
        return { outcome: { status: 'cancelled' }, completion }
      }
      return { outcome: { status: 'authorized' } }
    } catch (error) {
      // A withdrawn attempt and a declined prompt are outcomes, not failures:
      // the human said no, or closed the page. Anything else is the flow
      // failing and belongs to the caller, cause chain intact.
      const cancellationIsAbort = signal.aborted
        && (flow.awaitCancellation !== true || isAbortFailure(error, signal))
      if (observed.declined || cancellationIsAbort) return { outcome: { status: 'cancelled' } }
      throw error
    }
  }
}

export default AuthorizationService
