/** Apply-owned Account Settings Remote streams and command lifetimes. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-account-controller/remote'
import type {
  AccountAuthorizationAttemptId,
  AccountAuthorizationFailureCode,
  AccountAuthorizationFrame,
  AccountAuthorizationMethodId,
  AccountAuthorizationNoticeView,
  AccountAuthorizationPromptId,
  AccountAuthorizationPromptView,
  AccountAuthorizationSnapshot,
} from '@deepseek-ai/dsh-api-account-controller/types'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Narrow generated namespace used by this feature. */
export type AccountRemote = Pick<Context['remote']['account'],
  'watch' | 'authorize' | 'answer' | 'cancel' | 'deleteCredential'>

/** Fixed client error identifiers rendered only through locale copy. */
export type AccountUiError = AccountAuthorizationFailureCode
  | 'bad-request'
  | 'not-found'
  | 'stale-prompt'
  | 'in-flight'
  | 'read-only'
  | 'delete-failed'
  | 'unavailable'

/** One caller-owned authorization attempt; prompt answers are deliberately absent. */
export interface AccountAttemptReadback {
  readonly key: CredentialKey
  readonly attemptId: AccountAuthorizationAttemptId | null
  readonly phase: 'starting' | 'running' | 'authorized' | 'cancelled' | 'failed'
  readonly notices: readonly AccountAuthorizationNoticeView[]
  readonly prompt: AccountAuthorizationPromptView | null
  readonly pendingAnswer: boolean
  readonly failure: AccountAuthorizationFailureCode | null
}

/** Stable readback delivered through the registration hooks compartment. */
export interface AccountReadback {
  readonly status: 'loading' | 'ready' | 'offline' | 'error'
  readonly snapshot: AccountAuthorizationSnapshot | null
  readonly attempt: AccountAttemptReadback | null
  readonly pendingDeletion: CredentialKey | null
  readonly deletedLocally: CredentialKey | null
  readonly readError: AccountUiError | null
  readonly actionError: AccountUiError | null
}

const MAX_NOTICES = 16

/* v8 ignore next -- closed-union backstop; AccountAuthorizationFrame rejects new frame tags at compile time. */
function assertNever(value: never): never {
  throw new TypeError('unexpected account authorization frame: ' + JSON.stringify(value))
}

function errorCode(code: unknown): AccountUiError {
  switch (code) {
    case 'account/bad-request': return 'bad-request'
    case 'account/not-found': return 'not-found'
    case 'account/stale-prompt': return 'stale-prompt'
    case 'account/in-flight': return 'in-flight'
    case 'account/read-only': return 'read-only'
    case 'account/delete-failed': return 'delete-failed'
    default: return 'unavailable'
  }
}

/** One plugin-owned source; Remote snapshots never enter a UI interaction store. */
export class AccountSettingsSource {
  /** Stable observable bound by the renderer to the useAccount seat. */
  readonly state = createSnapshotStore<AccountReadback>({
    status: 'offline', snapshot: null, attempt: null, pendingDeletion: null,
    deletedLocally: null, readError: null, actionError: null,
  })
  private reader: AbortController | undefined
  private authorization: AbortController | undefined
  private generation: number | undefined
  private readonly streamTasks = new Set<Promise<unknown>>()
  private disposed = false

  /** @param remote - generated account namespace from the injecting context. */
  constructor(private readonly remote: AccountRemote) {}

  /**
   * Replace the connection lifetime and cancel its streams.
   * @param generation - usable connection identity, or undefined on loss.
   */
  connect(generation: number | undefined): void {
    if (this.disposed || generation === this.generation) return
    this.generation = generation
    this.restart()
  }

  /** Retry readback on the current usable connection. */
  restart(): void {
    if (this.disposed) return
    this.reader?.abort()
    this.authorization?.abort()
    this.reader = undefined
    this.authorization = undefined
    const previous = this.state.getSnapshot()
    this.state.set({
      ...previous,
      status: this.generation === undefined ? 'offline' : 'loading',
      attempt: null,
      pendingDeletion: null,
      readError: null,
      actionError: null,
    })
    if (this.generation === undefined) return
    const reader = new AbortController()
    this.reader = reader
    void this.trackStream(this.watch(reader))
  }

  /**
   * Start one caller-owned authorization stream when the current flow state permits it.
   * @param key - registered credential flow to authorize.
   * @param method - method advertised by that flow.
   * @returns `true` when the stream was started; otherwise records an unavailable action error.
   */
  start(key: CredentialKey, method: AccountAuthorizationMethodId): boolean {
    if (this.disposed) return false
    const current = this.state.getSnapshot()
    const attemptForKey = current.attempt?.key === key
    const flow = current.snapshot?.flows.find(candidate => candidate.key === key)
    if (current.status !== 'ready' || attemptForKey || current.pendingDeletion !== null
      || flow === undefined || flow.inFlight || !flow.methods.some(candidate => candidate.id === method)) {
      this.state.set({ ...current, actionError: 'unavailable' })
      return false
    }
    this.authorization?.abort()
    const authorization = new AbortController()
    this.authorization = authorization
    this.state.set({
      ...current,
      attempt: {
        key, attemptId: null, phase: 'starting', notices: [], prompt: null,
        pendingAnswer: false, failure: null,
      },
      deletedLocally: null,
      actionError: null,
    })
    void this.trackStream(this.consumeAuthorization(key, method, authorization))
    return true
  }

  /**
   * Submit one prompt answer without publishing or retaining its value.
   * @param promptId - current prompt identity owned by the active attempt.
   * @param answer - transient value sent to the Host authorization stream.
   * @returns `true` when the Host accepted the answer; otherwise records the safe failure state.
   */
  answer(promptId: AccountAuthorizationPromptId, answer: string): Promise<boolean> {
    return this.answerNow(promptId, answer)
  }

  private async answerNow(promptId: AccountAuthorizationPromptId, answer: string): Promise<boolean> {
    const generation = this.generation
    if (!this.currentGeneration(generation)) return false
    const current = this.state.getSnapshot()
    const attempt = current.attempt
    if (this.authorization === undefined || attempt?.phase !== 'running'
      || attempt.attemptId === null || attempt.attemptId === undefined
      || attempt.prompt?.id !== promptId || attempt.pendingAnswer) {
      this.state.set({ ...current, actionError: 'stale-prompt' })
      return false
    }
    this.state.set({ ...current, attempt: { ...attempt, pendingAnswer: true }, actionError: null })
    try {
      const result = await this.remote.answer(attempt.attemptId, promptId, answer)
      const latestAfterCommand = this.state.getSnapshot().attempt
      if (!this.currentGeneration(generation)
        || latestAfterCommand === null
        || latestAfterCommand.attemptId !== attempt.attemptId
        || latestAfterCommand.phase !== 'running') return false
      if (!result.ok) {
        this.state.set({ ...this.state.getSnapshot(), actionError: errorCode(result.error.code) })
        return false
      }
      const latest = this.state.getSnapshot()
      if (latest.attempt?.attemptId === attempt.attemptId && latest.attempt.prompt?.id === promptId) {
        this.state.set({ ...latest, attempt: { ...latest.attempt, prompt: null } })
      }
      return true
    } catch {
      if (this.currentGeneration(generation)
        && this.state.getSnapshot().attempt?.attemptId === attempt.attemptId) {
        this.state.set({ ...this.state.getSnapshot(), actionError: 'unavailable' })
      }
      return false
    } finally {
      const latest = this.state.getSnapshot()
      if (this.currentGeneration(generation) && latest.attempt?.attemptId === attempt.attemptId) {
        this.state.set({ ...latest, attempt: { ...latest.attempt, pendingAnswer: false } })
      }
    }
  }

  /**
   * Ask the Host to cancel the active caller-owned attempt.
   * @returns `true` when the Host accepted cancellation, or `false` when no active attempt remains.
   */
  cancel(): Promise<boolean> {
    return this.cancelNow()
  }

  private async cancelNow(): Promise<boolean> {
    const generation = this.generation
    if (!this.currentGeneration(generation)) return false
    const current = this.state.getSnapshot()
    const attemptId = current.attempt?.attemptId
    if (current.attempt?.phase !== 'running'
      || attemptId === null || attemptId === undefined || this.authorization === undefined) {
      this.state.set({ ...current, actionError: 'unavailable' })
      return false
    }
    try {
      const result = await this.remote.cancel(attemptId)
      if (!this.currentGeneration(generation)) return false
      if (!result.ok) {
        this.state.set({ ...this.state.getSnapshot(), actionError: errorCode(result.error.code) })
        return false
      }
      return result.value
    } catch {
      if (this.currentGeneration(generation)) {
        this.state.set({ ...this.state.getSnapshot(), actionError: 'unavailable' })
      }
      return false
    }
  }

  /**
   * Delete a local credential record; issuer revocation is not requested.
   * @param key - registered credential flow whose local record should be removed.
   * @returns `true` after local deletion succeeds, or `false` when the operation is unavailable or rejected.
   */
  deleteCredential(key: CredentialKey): Promise<boolean> {
    return this.deleteNow(key)
  }

  private async deleteNow(key: CredentialKey): Promise<boolean> {
    const generation = this.generation
    if (!this.currentGeneration(generation)) return false
    const current = this.state.getSnapshot()
    const flow = current.snapshot?.flows.find(candidate => candidate.key === key)
    const attemptForKey = current.attempt?.key === key
    if (current.status !== 'ready' || current.pendingDeletion !== null || flow === undefined
      || !flow.credential.configured || !flow.credential.writable || flow.inFlight
      || attemptForKey) {
      this.state.set({ ...current, actionError: 'unavailable' })
      return false
    }
    this.state.set({ ...current, pendingDeletion: key, actionError: null })
    try {
      const result = await this.remote.deleteCredential(key)
      if (!this.currentGeneration(generation)) return false
      if (!result.ok) {
        this.state.set({ ...this.state.getSnapshot(), actionError: errorCode(result.error.code) })
        return false
      }
      this.state.set({
        ...this.state.getSnapshot(),
        deletedLocally: key,
      })
      return true
    } catch {
      if (this.currentGeneration(generation)) {
        this.state.set({ ...this.state.getSnapshot(), actionError: 'unavailable' })
      }
      return false
    } finally {
      if (this.currentGeneration(generation)) {
        this.state.set({ ...this.state.getSnapshot(), pendingDeletion: null })
      }
    }
  }

  /** Remove a completed attempt from the local presentation. */
  dismissAttempt(): void {
    if (this.disposed) return
    const current = this.state.getSnapshot()
    if (current.attempt?.phase === 'starting' || current.attempt?.phase === 'running') return
    this.state.set({ ...current, attempt: null })
  }

  /** Clear local operation feedback without changing Host state. */
  clearFeedback(): void {
    if (this.disposed) return
    this.state.set({ ...this.state.getSnapshot(), deletedLocally: null, actionError: null })
  }

  private trackStream<T>(task: Promise<T>): Promise<T> {
    this.streamTasks.add(task)
    void task.then(
      () => { this.streamTasks.delete(task) },
      () => { this.streamTasks.delete(task) },
    )
    return task
  }

  private currentGeneration(generation: number | undefined): boolean {
    return !this.disposed && generation !== undefined && this.generation === generation
  }

  private current(reader: AbortController): boolean {
    return !this.disposed && this.reader === reader
  }

  private async watch(reader: AbortController): Promise<void> {
    try {
      for await (const snapshot of this.remote.watch(reader.signal)) {
        if (!this.current(reader)) return
        this.state.set({ ...this.state.getSnapshot(), status: 'ready', snapshot, readError: null })
      }
      if (this.current(reader)) this.failRead('unavailable')
    } catch (error) {
      if (this.current(reader)) this.failRead(errorCode((error as { code?: unknown } | null | undefined)?.code))
    }
  }

  private failRead(error: AccountUiError): void {
    this.state.set({ ...this.state.getSnapshot(), status: 'error', snapshot: null, readError: error })
  }

  private async consumeAuthorization(
    key: CredentialKey,
    method: AccountAuthorizationMethodId,
    authorization: AbortController,
  ): Promise<void> {
    try {
      for await (const frame of this.remote.authorize(key, method, authorization.signal)) {
        if (this.authorization !== authorization) return
        this.acceptFrame(frame, key, method)
      }
      const latest = this.state.getSnapshot()
      if (this.authorization === authorization
        && (latest.attempt?.phase === 'starting' || latest.attempt?.phase === 'running')) {
        this.state.set({
          ...latest,
          attempt: { ...latest.attempt, phase: 'failed', prompt: null, failure: 'unavailable' },
        })
      }
    } catch (error) {
      const latest = this.state.getSnapshot()
      if (this.authorization === authorization && latest.attempt !== null) {
        this.state.set({
          ...latest,
          attempt: { ...latest.attempt, phase: 'failed', prompt: null, failure: 'unavailable' },
          actionError: errorCode((error as { code?: unknown } | null | undefined)?.code),
        })
      }
    } finally {
      if (this.authorization === authorization) this.authorization = undefined
    }
  }

  private acceptFrame(
    frame: AccountAuthorizationFrame,
    key: CredentialKey,
    method: AccountAuthorizationMethodId,
  ): void {
    const current = this.state.getSnapshot()
    const attempt = current.attempt
    if (attempt === null) return
    if (attempt.phase !== 'starting' && attempt.phase !== 'running') return
    if (frame.type === 'started') {
      if (attempt.attemptId !== null || frame.key !== key || frame.method !== method) {
        this.rejectFrame(current, attempt)
        return
      }
      this.state.set({ ...current, attempt: { ...attempt, attemptId: frame.attemptId, phase: 'running' } })
      return
    }
    if (attempt.attemptId === null || frame.attemptId !== attempt.attemptId) {
      this.rejectFrame(current, attempt)
      return
    }
    switch (frame.type) {
      case 'notice':
        this.state.set({
          ...current,
          attempt: {
            ...attempt,
            notices: [...attempt.notices, frame.notice].slice(-MAX_NOTICES),
          },
        })
        return
      case 'prompt':
        this.state.set({ ...current, attempt: { ...attempt, prompt: frame.prompt, pendingAnswer: false } })
        return
      case 'prompt-withdrawn':
        if (attempt.prompt?.id === frame.promptId) {
          this.state.set({ ...current, attempt: { ...attempt, prompt: null, pendingAnswer: false } })
        }
        return
      case 'settled':
        this.state.set({
          ...current,
          attempt: {
            ...attempt,
            phase: frame.status,
            prompt: null,
            pendingAnswer: false,
            failure: frame.status === 'failed' ? frame.failure : null,
          },
        })
        return
      /* v8 ignore next -- closed-union backstop; AccountAuthorizationFrame rejects new frame tags at compile time. */
      default:
        return assertNever(frame)
    }
  }

  private rejectFrame(current: AccountReadback, attempt: AccountAttemptReadback): void {
    this.state.set({
      ...current,
      attempt: { ...attempt, phase: 'failed', prompt: null, pendingAnswer: false, failure: 'unavailable' },
      actionError: 'unavailable',
    })
    this.authorization?.abort()
  }

  /** Abort both owned streams without waiting for connection-owned unary commands. */
  async dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true
      this.generation = undefined
      this.reader?.abort()
      this.authorization?.abort()
      this.reader = undefined
      this.authorization = undefined
    }
    await Promise.all(this.streamTasks)
  }
}
