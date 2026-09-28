/** Secret-free Account Settings and caller-owned authorization interaction over Remote. */
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'
import type {} from '@deepseek-ai/dsh-authorization'
import type { AuthorizationNotice, AuthorizationPrompt } from '@deepseek-ai/dsh-authorization'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type {
  AccountAuthorizationAttemptId,
  AccountAuthorizationFailureCode,
  AccountAuthorizationFrame,
  AccountAuthorizationMethodId,
  AccountAuthorizationNoticeView,
  AccountAuthorizationPromptId,
  AccountAuthorizationPromptView,
  AccountAuthorizationSnapshot,
  AccountCredentialDeletionResult,
} from './types.ts'

export type * from './types.ts'

const MAX_SERIALIZED_FRAME_BYTES = 64 * 1_024
const MAX_SERIALIZED_SNAPSHOT_BYTES = 256 * 1_024
const MAX_QUEUED_FRAMES = 32

const keySchema = z.string().regex(new RegExp('^[a-z][a-z0-9-]*/[a-z][a-z0-9-]*$'))
const methodSchema = z.string().min(1).max(128)
const attemptIdSchema = z.uuid()
const promptIdSchema = z.uuid()
const answerSchema = z.string().max(16_384)

interface PendingPrompt {
  readonly id: AccountAuthorizationPromptId
  readonly view: AccountAuthorizationPromptView
  readonly resolve: (answer: string) => void
  readonly reject: (reason: unknown) => void
  readonly detach: () => void
}

interface OwnedStream {
  close(): Promise<void>
}

interface Attempt {
  readonly id: AccountAuthorizationAttemptId
  readonly key: CredentialKey
  readonly method: AccountAuthorizationMethodId
  readonly controller: AbortController
  readonly frames: AccountAuthorizationFrame[]
  prompt?: PendingPrompt
  wake?: () => void
  streamFailure?: RemoteError
  closed: boolean
  done: boolean
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function outputLimitError(): RemoteError {
  return new RemoteError('account/output-limit', 'account authorization output exceeded its wire limit', {})
}

function parseRequest<T>(method: string, schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new RemoteError('account/bad-request', 'invalid payload for ' + method, {})
  return parsed.data
}

function parseKey(value: CredentialKey): CredentialKey {
  parseRequest('credential key', keySchema, value)
  try {
    return parseCredentialKey(value)
  }
  /* v8 ignore start -- keySchema admits exactly the same two non-empty segments as parseCredentialKey. */
  catch (error) {
    throw new RemoteError('account/bad-request', 'invalid credential key', {}, { cause: error })
  }
  /* v8 ignore stop */
}

function failureCode(error: unknown): AccountAuthorizationFailureCode {
  switch ((error as { code?: unknown } | null)?.code) {
    case 'ALREADY_IN_FLIGHT': return 'busy'
    case 'SUB2API_INVALID_URL':
    case 'SUB2API_INVALID_INPUT': return 'invalid-input'
    case 'SUB2API_NETWORK': return 'network'
    case 'SUB2API_HTTP':
    case 'SUB2API_REJECTED': return 'rejected'
    case 'SUB2API_INVALID_RESPONSE': return 'invalid-response'
    case 'SUB2API_CLEANUP_FAILED': return 'cleanup-failed'
    case 'NOT_COMMITTED': return 'not-committed'
    default: return 'unavailable'
  }
}

function projectPrompt(id: AccountAuthorizationPromptId, prompt: AuthorizationPrompt): AccountAuthorizationPromptView {
  const common = {
    id,
    message: prompt.message,
    ...'placeholder' in prompt ? { placeholder: prompt.placeholder } : {},
    ...prompt.autocomplete === undefined ? {} : { autocomplete: prompt.autocomplete },
  }
  if (prompt.kind !== 'select') return { ...common, kind: prompt.kind }
  return {
    ...common,
    kind: 'select',
    options: prompt.options.map(option => ({
      id: option.id,
      label: option.label,
      ...option.description === undefined ? {} : { description: option.description },
    })),
  }
}

function projectNotice(notice: AuthorizationNotice): AccountAuthorizationNoticeView {
  let url: string | undefined
  if (notice.url !== undefined) {
    try {
      const parsed = new URL(notice.url)
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:')
        && parsed.username.length === 0 && parsed.password.length === 0) url = notice.url
    } catch {
      // A malformed provider URL is omitted; its non-secret notice remains useful.
    }
  }
  return {
    message: notice.message,
    ...url === undefined ? {} : { url },
    ...notice.code === undefined ? {} : { code: notice.code },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the account Remote namespace. */
    accountController: AccountController
  }
}

/** Account Settings controller over generic authorization flows and local credential records. */
export class AccountController extends TypertRemoteService {
  static inject = ['typert', 'authorization', 'credentials']
  private readonly lifetime = new AbortController()
  private readonly attempts = new Map<AccountAuthorizationAttemptId, Attempt>()
  private readonly streams = new Set<OwnedStream>()
  private readonly deleting = new Set<CredentialKey>()

  /** @param ctx - Host context containing authorization and credential services. */
  constructor(ctx: Context) {
    super(ctx, 'accountController', { namespace: 'account' })
    ctx.effect(() => async () => {
      this.lifetime.abort()
      for (const attempt of this.attempts.values()) attempt.controller.abort()
      await Promise.all([...this.streams].map(stream => stream.close()))
    }, 'account-controller.streams')
  }

  /**
   * Read registered authorization flows and local credential presence.
   * @returns complete secret-free Account Settings state, limited to 256 KiB as serialized UTF-8 JSON.
   * @throws RemoteError when the complete snapshot exceeds its wire limit.
   */
  @Remote
  async snapshot(): Promise<AccountAuthorizationSnapshot> {
    const flows = await Promise.all(this.ctx.authorization.list().map(async (flow) => {
      const credential = await this.ctx.credentials.describeRecord(flow.key)
      return {
        key: flow.key,
        label: flow.label,
        methods: flow.methods.map(method => ({
          id: brandString<AccountAuthorizationMethodId>(method.id),
          label: method.label,
        })),
        inFlight: flow.inFlight,
        credential: {
          configured: credential.configured,
          ...credential.kind === undefined ? {} : { kind: credential.kind },
          writable: credential.writable,
        },
      }
    }))
    const snapshot = { flows }
    if (serializedBytes(snapshot) > MAX_SERIALIZED_SNAPSHOT_BYTES) throw outputLimitError()
    return snapshot
  }

  /**
   * Observe complete replacement snapshots, coalescing changes for a paused client.
   * @param signal - caller and transport cancellation.
   * @returns initial state followed by flow, attempt, and credential changes.
   */
  @Remote({ mode: 'stream' })
  async *watch(signal: AbortSignal): AsyncIterable<AccountAuthorizationSnapshot> {
    const lifetime = AbortSignal.any([signal, this.lifetime.signal])
    lifetime.throwIfAborted()
    let dirty = true
    let wake: (() => void) | undefined
    const changed = (): void => { dirty = true; wake?.() }
    const unsubscribeAuthorization = this.ctx.authorization.subscribe(changed)
    const unsubscribeCredential = this.ctx.on('credentials/record-updated', (key) => {
      if (this.ctx.authorization.describe(key) !== undefined) changed()
    })
    let snapshotWork: Promise<AccountAuthorizationSnapshot> | undefined
    let closePromise: Promise<void> | undefined
    const owner: OwnedStream = {
      close: () => {
        if (closePromise !== undefined) return closePromise
        closePromise = (async () => {
          unsubscribeCredential()
          unsubscribeAuthorization()
          wake?.()
          wake = undefined
          await snapshotWork?.catch(() => undefined)
          this.streams.delete(owner)
        })()
        return closePromise
      },
    }
    this.streams.add(owner)
    try {
      while (!lifetime.aborted) {
        if (dirty) {
          dirty = false
          const work = this.snapshot()
          snapshotWork = work
          try {
            yield await work
          } finally {
            if (snapshotWork === work) snapshotWork = undefined
          }
          continue
        }
        await new Promise<void>((resolve) => {
          const done = (): void => {
            lifetime.removeEventListener('abort', done)
            wake = undefined
            resolve()
          }
          wake = done
          lifetime.addEventListener('abort', done, { once: true })
        })
      }
    } finally {
      await owner.close()
    }
  }

  /**
   * Run one authorization through a stream owned by the caller that started it.
   * @param keyValue - registered credential record key.
   * @param methodValue - method advertised for that flow.
   * @param signal - closes this caller's stream and cancels its attempt.
   * @returns notices, prompt metadata, and settlement; every serialized frame is at most 64 KiB.
   * @throws RemoteError when control-frame volume or one control frame exceeds its output limit.
   */
  @Remote({ mode: 'stream' })
  async *authorize(
    keyValue: CredentialKey,
    methodValue: AccountAuthorizationMethodId,
    signal: AbortSignal,
  ): AsyncIterable<AccountAuthorizationFrame> {
    const key = parseKey(keyValue)
    const methodText = parseRequest('account.authorize', methodSchema, methodValue)
    const flow = this.ctx.authorization.describe(key)
    if (flow === undefined || !flow.methods.some(candidate => candidate.id === methodText)) {
      throw new RemoteError('account/not-found', 'authorization flow or method is unavailable', { key })
    }
    if (this.deleting.has(key)) {
      throw new RemoteError('account/in-flight', 'local credential deletion is currently running', { key })
    }
    const lifetime = AbortSignal.any([signal, this.lifetime.signal])
    lifetime.throwIfAborted()
    const attempt: Attempt = {
      id: brandString<AccountAuthorizationAttemptId>(randomUUID()),
      key,
      method: brandString<AccountAuthorizationMethodId>(methodText),
      controller: new AbortController(),
      frames: [],
      closed: false,
      done: false,
    }
    this.attempts.set(attempt.id, attempt)
    this.enqueue(attempt, { type: 'started', attemptId: attempt.id, key, method: attempt.method })
    const abort = (): void => { attempt.controller.abort(lifetime.reason) }
    lifetime.addEventListener('abort', abort, { once: true })
    const running = Promise.withResolvers<void>()
    let closePromise: Promise<void> | undefined
    const owner: OwnedStream = {
      close: () => {
        if (closePromise !== undefined) return closePromise
        closePromise = (async () => {
          attempt.closed = true
          lifetime.removeEventListener('abort', abort)
          attempt.controller.abort()
          attempt.wake?.()
          attempt.frames.length = 0
          this.attempts.delete(attempt.id)
          await running.promise
          this.streams.delete(owner)
        })()
        return closePromise
      },
    }
    this.streams.add(owner)
    void this.runAttempt(attempt).then(running.resolve, running.reject)
    try {
      while (!lifetime.aborted && !attempt.closed) {
        const frame = attempt.frames.shift()
        if (frame !== undefined) {
          yield frame
          continue
        }
        if (attempt.done) break
        await this.wait(attempt, lifetime)
      }
      if (!lifetime.aborted && !attempt.closed && attempt.streamFailure !== undefined) {
        throw attempt.streamFailure
      }
    } finally {
      await owner.close()
    }
  }

  /**
   * Submit one prompt answer. The answer is resolved directly to the flow and is never retained or returned.
   * @param attemptValue - caller-owned attempt identity.
   * @param promptValue - current prompt identity.
   * @param answerValue - text, secret, or selected option value.
   */
  @Remote
  answer(
    attemptValue: AccountAuthorizationAttemptId,
    promptValue: AccountAuthorizationPromptId,
    answerValue: string,
  ): void {
    const attemptId = brandString<AccountAuthorizationAttemptId>(
      parseRequest('account.answer attempt', attemptIdSchema, attemptValue))
    const promptId = brandString<AccountAuthorizationPromptId>(
      parseRequest('account.answer prompt', promptIdSchema, promptValue))
    const answer = parseRequest('account.answer value', answerSchema, answerValue)
    const attempt = this.attempts.get(attemptId)
    const pending = attempt?.prompt
    if (attempt === undefined || attempt.done || attempt.controller.signal.aborted
      || pending === undefined || pending.id !== promptId) {
      throw new RemoteError('account/stale-prompt', 'authorization prompt is no longer active', { attemptId, promptId })
    }
    if (pending.view.kind === 'select' && !pending.view.options.some(option => option.id === answer)) {
      throw new RemoteError('account/bad-request', 'authorization selection is invalid', { attemptId, promptId })
    }
    delete attempt.prompt
    pending.detach()
    pending.resolve(answer)
    this.enqueue(attempt, { type: 'prompt-withdrawn', attemptId, promptId })
  }

  /**
   * Cancel only the attempt named by the caller-owned identity.
   * @param attemptValue - active attempt identity.
   * @returns true when the attempt was still active.
   */
  @Remote
  cancel(attemptValue: AccountAuthorizationAttemptId): boolean {
    const attemptId = brandString<AccountAuthorizationAttemptId>(
      parseRequest('account.cancel', attemptIdSchema, attemptValue))
    const attempt = this.attempts.get(attemptId)
    if (attempt === undefined || attempt.done || attempt.controller.signal.aborted) return false
    attempt.controller.abort()
    return true
  }

  /**
   * Delete one flow's local credential record without claiming issuer revocation.
   * @param keyValue - registered flow key.
   * @returns local deletion result with issuerRevoked fixed to false.
   */
  @Remote
  async deleteCredential(keyValue: CredentialKey): Promise<AccountCredentialDeletionResult> {
    const key = parseKey(keyValue)
    const flow = this.ctx.authorization.describe(key)
    const hasControllerAttempt = [...this.attempts.values()].some(attempt => attempt.key === key)
    if (flow === undefined) throw new RemoteError('account/not-found', 'authorization flow is unavailable', { key })
    if (flow.inFlight || hasControllerAttempt || this.deleting.has(key)) {
      throw new RemoteError('account/in-flight', 'account credential operation is currently running', { key })
    }
    this.deleting.add(key)
    try {
      return await this.ctx.authorization.withExclusiveKey(key, async () => {
        const before = await this.ctx.credentials.describeRecord(key)
        if (!before.writable) throw new RemoteError('account/read-only', 'local credential record is read-only', { key })
        try {
          await this.ctx.credentials.deleteRecord(key)
        } catch (error) {
          throw new RemoteError('account/delete-failed', 'local credential deletion failed', { key }, { cause: error })
        }
        return { localDeleted: before.configured, issuerRevoked: false }
      })
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'ALREADY_IN_FLIGHT') {
        throw new RemoteError('account/in-flight', 'account credential operation is currently running', { key })
      }
      throw error
    } finally {
      this.deleting.delete(key)
    }
  }

  /** Run the seam attempt and finish the caller stream with only a safe failure class. */
  private async runAttempt(attempt: Attempt): Promise<void> {
    let settlement: AccountAuthorizationFrame
    try {
      const outcome = await this.ctx.authorization.begin({
        key: attempt.key,
        method: attempt.method,
        signal: attempt.controller.signal,
        interaction: {
          notify: (notice) => { this.enqueue(attempt, {
            type: 'notice', attemptId: attempt.id, notice: projectNotice(notice),
          }) },
          prompt: prompt => this.prompt(attempt, prompt),
        },
      })
      settlement = { type: 'settled', attemptId: attempt.id, status: outcome.status }
    } catch (error) {
      settlement = { type: 'settled', attemptId: attempt.id, status: 'failed', failure: failureCode(error) }
    }
    const pending = attempt.prompt
    if (pending !== undefined) {
      delete attempt.prompt
      pending.detach()
      pending.reject(new Error('authorization attempt has already settled'))
      this.enqueue(attempt, { type: 'prompt-withdrawn', attemptId: attempt.id, promptId: pending.id })
    }
    attempt.done = true
    this.enqueue(attempt, settlement)
    attempt.wake?.()
  }

  /** Publish prompt metadata and resolve only through answer or prompt cancellation. */
  private prompt(attempt: Attempt, prompt: AuthorizationPrompt): Promise<string> {
    const signal = prompt.signal === undefined
      ? attempt.controller.signal
      : AbortSignal.any([prompt.signal, attempt.controller.signal])
    signal.throwIfAborted()
    if (attempt.closed || attempt.done || attempt.controller.signal.aborted) {
      return Promise.reject(new Error('authorization attempt has already settled'))
    }
    if (attempt.prompt !== undefined) return Promise.reject(new Error('authorization flow requested concurrent prompts'))
    const id = brandString<AccountAuthorizationPromptId>(randomUUID())
    const view = projectPrompt(id, prompt)
    return new Promise<string>((resolve, reject) => {
      const withdrawn = (): void => {
        /* v8 ignore next -- detach removes this listener before the pending prompt identity can change. */
        if (attempt.prompt?.id !== id) return
        delete attempt.prompt
        this.enqueue(attempt, { type: 'prompt-withdrawn', attemptId: attempt.id, promptId: id })
        reject(signal.reason instanceof Error
          ? signal.reason
          : new Error('authorization prompt withdrawn'))
      }
      const detach = (): void => { signal.removeEventListener('abort', withdrawn) }
      attempt.prompt = { id, view, resolve, reject, detach }
      signal.addEventListener('abort', withdrawn, { once: true })
      this.enqueue(attempt, { type: 'prompt', attemptId: attempt.id, prompt: view })
    })
  }

  /** Stop a stream whose complete serialized output cannot stay within its limits. */
  private failOutput(attempt: Attempt): void {
    attempt.streamFailure = outputLimitError()
    attempt.controller.abort(attempt.streamFailure)
    attempt.wake?.()
  }

  /** Queue one byte-bounded frame; only notice frames may be discarded under pressure. */
  private enqueue(attempt: Attempt, frame: AccountAuthorizationFrame): void {
    if (attempt.closed || attempt.streamFailure !== undefined) return
    if (serializedBytes(frame) > MAX_SERIALIZED_FRAME_BYTES) {
      if (frame.type === 'notice') return
      this.failOutput(attempt)
      return
    }
    if (attempt.frames.length >= MAX_QUEUED_FRAMES) {
      const notice = attempt.frames.findIndex(candidate => candidate.type === 'notice')
      if (notice >= 0) attempt.frames.splice(notice, 1)
      else if (frame.type === 'notice') return
      else {
        this.failOutput(attempt)
        return
      }
    }
    attempt.frames.push(frame)
    attempt.wake?.()
  }

  /** Wait for a frame, settlement, or stream cancellation. */
  private wait(attempt: Attempt, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        signal.removeEventListener('abort', done)
        delete attempt.wake
        resolve()
      }
      attempt.wake = done
      signal.addEventListener('abort', done, { once: true })
    })
  }
}

export default AccountController
