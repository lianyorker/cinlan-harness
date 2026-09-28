import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AccountAuthorizationAttemptId, AccountAuthorizationFrame, AccountAuthorizationMethodId,
  AccountAuthorizationPromptId, AccountAuthorizationSnapshot,
} from '@deepseek-ai/dsh-api-account-controller/types'
import { AccountSettingsSource, type AccountRemote } from '../src/client/source.ts'

const KEY = credentialKey('llm-pi-ai', 'sub2api')
const METHOD = 'password' as AccountAuthorizationMethodId
const ATTEMPT = '11111111-1111-4111-8111-111111111111' as AccountAuthorizationAttemptId
const PROMPT = '22222222-2222-4222-8222-222222222222' as AccountAuthorizationPromptId
const OTHER_PROMPT = '33333333-3333-4333-8333-333333333333' as AccountAuthorizationPromptId
const OTHER_ATTEMPT = '44444444-4444-4444-8444-444444444444' as AccountAuthorizationAttemptId
const OTHER_KEY = credentialKey('llm-pi-ai', 'other')
const initial: AccountAuthorizationSnapshot = {
  flows: [{
    key: KEY,
    label: 'Cinlan account',
    methods: [{ id: METHOD, label: 'Sign in to Cinlan' }],
    inFlight: false,
    credential: { configured: true, kind: 'api-key', writable: true },
  }],
}

const streams: { close(): void }[] = []

class TestStream<T> implements AsyncIterable<T> {
  private readonly completion = Promise.withResolvers<undefined>()
  readonly finished = this.completion.promise
  constructor() { streams.push(this) }
  private readonly values: ({ value: T } | { error: unknown } | { done: true })[] = []
  private wake: (() => void) | undefined
  push(value: T): void { this.values.push({ value }); this.wake?.() }
  close(): void { this.values.push({ done: true }); this.wake?.() }
  fail(error: unknown): void { this.values.push({ error }); this.wake?.() }
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    try {
      while (true) {
        if (this.values.length === 0) await new Promise<void>((resolve) => { this.wake = resolve })
        this.wake = undefined
        const item = this.values.shift()
        if (item === undefined) continue
        if ('error' in item) throw item.error
        if ('done' in item) return
        yield item.value
      }
    } finally {
      this.completion.resolve(undefined)
    }
  }
}

const sources: AccountSettingsSource[] = []
afterEach(async () => {
  for (const stream of streams.splice(0)) stream.close()
  for (const source of sources.splice(0)) await source.dispose()
})

function fixture(overrides: Partial<AccountRemote> = {}) {
  const watch = new TestStream<AccountAuthorizationSnapshot>()
  const authorize = new TestStream<AccountAuthorizationFrame>()
  const answer = vi.fn(async () => ({ ok: true as const, value: undefined }))
  const cancel = vi.fn(async () => ({ ok: true as const, value: true }))
  const deleteCredential = vi.fn(async () => ({
    ok: true as const, value: { localDeleted: true, issuerRevoked: false as const },
  }))
  const remote = {
    watch: (signal: AbortSignal) => {
      signal.addEventListener('abort', () => { watch.close() }, { once: true })
      return watch
    },
    authorize: (_key: typeof KEY, _method: AccountAuthorizationMethodId, signal: AbortSignal) => {
      signal.addEventListener('abort', () => { authorize.close() }, { once: true })
      return authorize
    },
    answer,
    cancel,
    deleteCredential,
    ...overrides,
  } as unknown as AccountRemote
  const source = new AccountSettingsSource(remote)
  sources.push(source)
  return { source, watch, authorize, answer, cancel, deleteCredential }
}

type Fixture = ReturnType<typeof fixture>

async function ready(f: Fixture, snapshot: AccountAuthorizationSnapshot = initial): Promise<void> {
  f.source.connect(1)
  f.watch.push(snapshot)
  await vi.waitFor(() => { expect(f.source.state.getSnapshot().status).toBe('ready') })
}

async function prompted(f: Fixture): Promise<void> {
  await ready(f)
  expect(f.source.start(KEY, METHOD)).toBe(true)
  f.authorize.push({ type: 'started', attemptId: ATTEMPT, key: KEY, method: METHOD })
  f.authorize.push({
    type: 'prompt', attemptId: ATTEMPT,
    prompt: { id: PROMPT, kind: 'secret', message: 'Password' },
  })
  await vi.waitFor(() => { expect(f.source.state.getSnapshot().attempt?.prompt?.id).toBe(PROMPT) })
}

describe('AccountSettingsSource', () => {
  it('publishes secret-free authorization frames and local-only deletion feedback', async () => {
    const f = fixture()
    f.source.connect(1)
    f.watch.push(initial)
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().status).toBe('ready') })
    expect(f.source.start(KEY, METHOD)).toBe(true)
    f.authorize.push({ type: 'started', attemptId: ATTEMPT, key: KEY, method: METHOD })
    for (let index = 0; index < 18; index += 1) {
      f.authorize.push({ type: 'notice', attemptId: ATTEMPT, notice: { message: 'Notice ' + String(index) } })
    }
    f.authorize.push({
      type: 'prompt', attemptId: ATTEMPT,
      prompt: { id: PROMPT, kind: 'secret', message: 'Password' },
    })
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().attempt?.prompt?.id).toBe(PROMPT) })
    expect(f.source.state.getSnapshot().attempt?.notices).toHaveLength(16)

    await expect(f.source.answer(PROMPT, 'private-answer')).resolves.toBe(true)
    expect(f.answer).toHaveBeenCalledWith(ATTEMPT, PROMPT, 'private-answer')
    expect(JSON.stringify(f.source.state.getSnapshot())).not.toContain('private-answer')
    f.authorize.push({ type: 'prompt-withdrawn', attemptId: ATTEMPT, promptId: PROMPT })
    f.authorize.push({ type: 'settled', attemptId: ATTEMPT, status: 'authorized' })
    f.authorize.close()
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().attempt?.phase).toBe('authorized') })
    await f.authorize.finished
    await vi.waitFor(() => {
      expect((f.source as unknown as { authorization?: unknown }).authorization).toBeUndefined()
    })
    f.source.dismissAttempt()

    await expect(f.source.deleteCredential(KEY)).resolves.toBe(true)
    expect(f.deleteCredential).toHaveBeenCalledWith(KEY)
    expect(f.source.state.getSnapshot().deletedLocally).toBe(KEY)
    f.source.clearFeedback()
    expect(f.source.state.getSnapshot().deletedLocally).toBeNull()
    f.source.dismissAttempt()
    expect(f.source.state.getSnapshot().attempt).toBeNull()
  })

  it('rejects local deletion while the same authorization stream is active or settling', async () => {
    const active = fixture()
    await prompted(active)
    await expect(active.source.deleteCredential(KEY)).resolves.toBe(false)
    expect(active.deleteCredential).not.toHaveBeenCalled()

    const settling = fixture()
    await ready(settling)
    expect(settling.source.start(KEY, METHOD)).toBe(true)
    settling.authorize.push({ type: 'started', attemptId: ATTEMPT, key: KEY, method: METHOD })
    settling.authorize.push({ type: 'settled', attemptId: ATTEMPT, status: 'authorized' })
    await vi.waitFor(() => { expect(settling.source.state.getSnapshot().attempt?.phase).toBe('authorized') })
    await expect(settling.source.deleteCredential(KEY)).resolves.toBe(false)
    expect(settling.deleteCredential).not.toHaveBeenCalled()
    settling.authorize.close()
    await settling.authorize.finished
    await vi.waitFor(() => {
      expect((settling.source as unknown as { authorization?: unknown }).authorization).toBeUndefined()
    })
    settling.source.dismissAttempt()
    await expect(settling.source.deleteCredential(KEY)).resolves.toBe(true)
  })

  it('cancels an active attempt and cancels both streams when the connection is lost', async () => {
    const f = fixture()
    f.source.connect(1)
    f.watch.push(initial)
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().status).toBe('ready') })
    f.source.start(KEY, METHOD)
    f.authorize.push({ type: 'started', attemptId: ATTEMPT, key: KEY, method: METHOD })
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().attempt?.attemptId).toBe(ATTEMPT) })
    await expect(f.source.cancel()).resolves.toBe(true)
    expect(f.cancel).toHaveBeenCalledWith(ATTEMPT)
    f.source.connect(undefined)
    expect(f.source.state.getSnapshot()).toMatchObject({ status: 'offline', attempt: null })
  })

  it('clears the account snapshot when a ready watch stream fails', async () => {
    const f = fixture()
    await ready(f)
    f.watch.fail(new Error('account service unavailable'))
    await vi.waitFor(() => {
      expect(f.source.state.getSnapshot()).toMatchObject({ status: 'error', snapshot: null, readError: 'unavailable' })
    })
    expect(f.source.start(KEY, METHOD)).toBe(false)
    await expect(f.source.deleteCredential(KEY)).resolves.toBe(false)
  })

  it('maps stream failures to fixed errors and removes rejected stream tasks', async () => {
    const f = fixture()
    f.source.connect(1)
    f.watch.fail(Object.assign(new Error('provider detail'), { code: 'account/not-found' }))
    await vi.waitFor(() => {
      expect(f.source.state.getSnapshot()).toMatchObject({ status: 'error', readError: 'not-found' })
    })

    const tracked = (f.source as unknown as {
      trackStream<T>(task: Promise<T>): Promise<T>
    }).trackStream(Promise.reject(new Error('tracked failure')))
    await expect(tracked).rejects.toThrow('tracked failure')
    await expect(f.source.dispose()).resolves.toBeUndefined()
  })

  it('rejects commands whose current state does not authorize them', async () => {
    const f = fixture()
    expect(f.source.start(KEY, METHOD)).toBe(false)
    await expect(f.source.deleteCredential(KEY)).resolves.toBe(false)
    f.source.connect(1)
    f.source.connect(1)
    f.watch.push(initial)
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().status).toBe('ready') })

    expect(f.source.start(OTHER_KEY, METHOD)).toBe(false)
    await expect(f.source.deleteCredential(OTHER_KEY)).resolves.toBe(false)
    f.watch.push({ flows: [{ ...initial.flows[0]!, inFlight: true }] })
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().snapshot?.flows[0]?.inFlight).toBe(true) })
    expect(f.source.start(KEY, METHOD)).toBe(false)
    await expect(f.source.deleteCredential(KEY)).resolves.toBe(false)

    f.watch.push({ flows: [{ ...initial.flows[0]!, inFlight: false, credential: { configured: false, writable: true } }] })
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().snapshot?.flows[0]?.credential.configured).toBe(false) })
    await expect(f.source.deleteCredential(KEY)).resolves.toBe(false)
    f.watch.push({ flows: [{ ...initial.flows[0]!, credential: { configured: true, kind: 'api-key', writable: false } }] })
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().snapshot?.flows[0]?.credential.writable).toBe(false) })
    await expect(f.source.deleteCredential(KEY)).resolves.toBe(false)

    f.watch.push(initial)
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().snapshot).toEqual(initial) })
    expect(f.source.start(KEY, 'other' as AccountAuthorizationMethodId)).toBe(false)
    expect(f.source.start(KEY, METHOD)).toBe(true)
    f.source.dismissAttempt()
    expect(f.source.state.getSnapshot().attempt?.phase).toBe('starting')
    await expect(f.source.cancel()).resolves.toBe(false)
    expect(f.source.start(KEY, METHOD)).toBe(false)
    f.authorize.push({ type: 'started', attemptId: ATTEMPT, key: KEY, method: METHOD })
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().attempt?.phase).toBe('running') })
    f.source.dismissAttempt()
    expect(f.source.state.getSnapshot().attempt?.phase).toBe('running')
  })

  it('blocks another command while local deletion owns the key', async () => {
    type DeleteResult = Awaited<ReturnType<AccountRemote['deleteCredential']>>
    const pending = Promise.withResolvers<DeleteResult>()
    const f = fixture({ deleteCredential: vi.fn(() => pending.promise) })
    await ready(f)

    const deleting = f.source.deleteCredential(KEY)
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().pendingDeletion).toBe(KEY) })
    await expect(f.source.deleteCredential(KEY)).resolves.toBe(false)
    expect(f.source.start(KEY, METHOD)).toBe(false)
    pending.resolve({ ok: true, value: { localDeleted: true, issuerRevoked: false } })
    await expect(deleting).resolves.toBe(true)
  })

  it.each([
    ['account/bad-request', 'bad-request'],
    ['account/not-found', 'not-found'],
    ['account/stale-prompt', 'stale-prompt'],
    ['account/in-flight', 'in-flight'],
    ['account/read-only', 'read-only'],
    ['account/delete-failed', 'delete-failed'],
    ['account/output-limit', 'unavailable'],
  ] as const)('maps Remote command failure %s to %s', async (code, expected) => {
    const deleteCredential = vi.fn(async () => ({
      ok: false as const, error: { code, message: 'private remote detail', details: {} },
    })) as unknown as AccountRemote['deleteCredential']
    const f = fixture({ deleteCredential })
    await ready(f)

    await expect(f.source.deleteCredential(KEY)).resolves.toBe(false)
    expect(f.source.state.getSnapshot()).toMatchObject({
      pendingDeletion: null, deletedLocally: null, actionError: expected,
    })
  })

  it('contains active answer failures and clears a withdrawn prompt before a late success', async () => {
    type AnswerResult = Awaited<ReturnType<AccountRemote['answer']>>
    const pending = Promise.withResolvers<AnswerResult>()
    const answer = vi.fn(() => pending.promise) as unknown as AccountRemote['answer']
    const f = fixture({ answer })
    await prompted(f)

    await expect(f.source.answer(OTHER_PROMPT, 'wrong prompt')).resolves.toBe(false)
    const answering = f.source.answer(PROMPT, 'private answer')
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().attempt?.pendingAnswer).toBe(true) })
    await expect(f.source.answer(PROMPT, 'duplicate answer')).resolves.toBe(false)
    f.authorize.push({ type: 'prompt-withdrawn', attemptId: ATTEMPT, promptId: PROMPT })
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().attempt?.prompt).toBeNull() })
    pending.resolve({ ok: true, value: undefined })
    await expect(answering).resolves.toBe(true)
    expect(JSON.stringify(f.source.state.getSnapshot())).not.toContain('private answer')
  })

  it('maps an answer refusal returned by the Remote', async () => {
    const f = fixture({ answer: vi.fn(async () => ({
      ok: false as const,
      error: new RemoteError('account/stale-prompt', 'private remote detail', { attemptId: ATTEMPT, promptId: PROMPT }),
    })) })
    await prompted(f)

    await expect(f.source.answer(PROMPT, 'private answer')).resolves.toBe(false)
    expect(f.source.state.getSnapshot()).toMatchObject({ actionError: 'stale-prompt' })
    expect(f.source.state.getSnapshot().attempt?.pendingAnswer).toBe(false)
  })

  it('ignores a frame from an older watch stream after reconnect', async () => {
    const oldWatch = new TestStream<AccountAuthorizationSnapshot>()
    const currentWatch = new TestStream<AccountAuthorizationSnapshot>()
    const watches = [oldWatch, currentWatch]
    let watchIndex = 0
    const f = fixture({
      watch: (_signal?: AbortSignal) => watches[watchIndex++]!,
    })
    f.source.connect(1)
    oldWatch.push(initial)
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().status).toBe('ready') })

    f.source.connect(2)
    currentWatch.push(initial)
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().status).toBe('ready') })
    oldWatch.push({ flows: [{ ...initial.flows[0]!, label: 'stale snapshot' }] })
    await oldWatch.finished
    expect(f.source.state.getSnapshot().snapshot?.flows[0]?.label).toBe('Cinlan account')

    oldWatch.close()
    currentWatch.close()
  })

  it('contains an error from an older watch stream after reconnect', async () => {
    const oldWatch = new TestStream<AccountAuthorizationSnapshot>()
    const currentWatch = new TestStream<AccountAuthorizationSnapshot>()
    const watches = [oldWatch, currentWatch]
    let watchIndex = 0
    const f = fixture({ watch: (_signal?: AbortSignal) => watches[watchIndex++]! })
    f.source.connect(1)
    oldWatch.push(initial)
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().status).toBe('ready') })
    f.source.connect(2)
    currentWatch.push(initial)
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().status).toBe('ready') })

    oldWatch.fail(Object.assign(new Error('stale watch transport detail'), { code: 'account/not-found' }))
    await oldWatch.finished
    expect(f.source.state.getSnapshot()).toMatchObject({ status: 'ready', readError: null })
    currentWatch.close()
  })

  it('contains an error from an older authorization stream after reconnect', async () => {
    const watches = [
      new TestStream<AccountAuthorizationSnapshot>(),
      new TestStream<AccountAuthorizationSnapshot>(),
      new TestStream<AccountAuthorizationSnapshot>(),
    ]
    const oldAuthorization = new TestStream<AccountAuthorizationFrame>()
    const currentAuthorization = new TestStream<AccountAuthorizationFrame>()
    let watchIndex = 0
    let authorizationIndex = 0
    const f = fixture({
      watch: (_signal?: AbortSignal) => watches[watchIndex++]!,
      authorize: (_key: typeof KEY, _method: AccountAuthorizationMethodId, _signal?: AbortSignal) =>
        [oldAuthorization, currentAuthorization][authorizationIndex++]!,
    })
    f.source.connect(1)
    watches[0]!.push(initial)
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().status).toBe('ready') })
    expect(f.source.start(KEY, METHOD)).toBe(true)
    oldAuthorization.push({ type: 'started', attemptId: ATTEMPT, key: KEY, method: METHOD })
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().attempt?.attemptId).toBe(ATTEMPT) })

    f.source.connect(2)
    watches[1]!.push(initial)
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().status).toBe('ready') })
    expect(f.source.start(KEY, METHOD)).toBe(true)
    currentAuthorization.push({ type: 'started', attemptId: OTHER_ATTEMPT, key: KEY, method: METHOD })
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().attempt?.attemptId).toBe(OTHER_ATTEMPT) })

    f.source.connect(3)
    watches[2]!.push(initial)
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().status).toBe('ready') })
    currentAuthorization.fail(Object.assign(new Error('stale authorization transport detail'), { code: 'account/not-found' }))
    await currentAuthorization.finished
    expect(f.source.state.getSnapshot()).toMatchObject({ status: 'ready', attempt: null, actionError: null })
    oldAuthorization.close()
    watches[0]!.close()
    watches[1]!.close()
    watches[2]!.close()
  })

  it('ignores a frame from an older authorization stream after reconnect', async () => {
    const oldWatch = new TestStream<AccountAuthorizationSnapshot>()
    const currentWatch = new TestStream<AccountAuthorizationSnapshot>()
    const oldAuthorization = new TestStream<AccountAuthorizationFrame>()
    const currentAuthorization = new TestStream<AccountAuthorizationFrame>()
    const watches = [oldWatch, currentWatch]
    const authorizations = [oldAuthorization, currentAuthorization]
    let watchIndex = 0
    let authorizationIndex = 0
    const f = fixture({
      watch: (_signal?: AbortSignal) => watches[watchIndex++]!,
      authorize: (_key: typeof KEY, _method: AccountAuthorizationMethodId, _signal?: AbortSignal) =>
        authorizations[authorizationIndex++]!,
    })
    f.source.connect(1)
    oldWatch.push(initial)
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().status).toBe('ready') })
    expect(f.source.start(KEY, METHOD)).toBe(true)
    oldAuthorization.push({ type: 'started', attemptId: ATTEMPT, key: KEY, method: METHOD })
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().attempt?.attemptId).toBe(ATTEMPT) })

    f.source.connect(2)
    currentWatch.push(initial)
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().status).toBe('ready') })
    expect(f.source.start(KEY, METHOD)).toBe(true)
    currentAuthorization.push({ type: 'started', attemptId: OTHER_ATTEMPT, key: KEY, method: METHOD })
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().attempt?.attemptId).toBe(OTHER_ATTEMPT) })
    oldAuthorization.push({ type: 'notice', attemptId: ATTEMPT, notice: { message: 'stale notice' } })
    await oldAuthorization.finished
    expect(f.source.state.getSnapshot().attempt?.notices).toEqual([])
    currentAuthorization.push({ type: 'settled', attemptId: OTHER_ATTEMPT, status: 'authorized' })
    currentAuthorization.close()
    oldAuthorization.close()
    oldWatch.close()
    currentWatch.close()
  })

  it('contains an answer rejection after the connection is lost', async () => {
    type AnswerResult = Awaited<ReturnType<AccountRemote['answer']>>
    const pending = Promise.withResolvers<AnswerResult>()
    const f = fixture({ answer: vi.fn(() => pending.promise) })
    await prompted(f)

    const answering = f.source.answer(PROMPT, 'private answer')
    f.source.connect(undefined)
    pending.reject(new Error('late answer transport detail'))
    await expect(answering).resolves.toBe(false)
    expect(f.source.state.getSnapshot().actionError).toBeNull()
  })

  it('contains a cancel rejection after the connection is lost', async () => {
    type CancelResult = Awaited<ReturnType<AccountRemote['cancel']>>
    const pending = Promise.withResolvers<CancelResult>()
    const f = fixture({ cancel: vi.fn(() => pending.promise) })
    await prompted(f)

    const cancelling = f.source.cancel()
    f.source.connect(undefined)
    pending.reject(new Error('late cancel transport detail'))
    await expect(cancelling).resolves.toBe(false)
    expect(f.source.state.getSnapshot().actionError).toBeNull()
  })

  it('maps an answer rejection while the connection remains current', async () => {
    const f = fixture({ answer: vi.fn(() => Promise.reject(new Error('private transport detail'))) })
    await prompted(f)

    await expect(f.source.answer(PROMPT, 'private answer')).resolves.toBe(false)
    expect(f.source.state.getSnapshot()).toMatchObject({ actionError: 'unavailable' })
    expect(f.source.state.getSnapshot().attempt?.pendingAnswer).toBe(false)
  })

  it('rejects a duplicate started frame and ignores the late answer result', async () => {
    type AnswerResult = Awaited<ReturnType<AccountRemote['answer']>>
    const pending = Promise.withResolvers<AnswerResult>()
    const f = fixture({ answer: vi.fn(() => pending.promise) })
    await prompted(f)

    const answering = f.source.answer(PROMPT, 'private answer')
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().attempt?.pendingAnswer).toBe(true) })
    f.authorize.push({ type: 'started', attemptId: OTHER_ATTEMPT, key: KEY, method: METHOD })
    await vi.waitFor(() => {
      expect(f.source.state.getSnapshot().attempt).toMatchObject({ phase: 'failed', failure: 'unavailable' })
    })
    pending.resolve({ ok: true, value: undefined })
    await expect(answering).resolves.toBe(false)
  })

  it('rejects a started frame with the wrong flow identity', async () => {
    const f = fixture()
    await ready(f)
    expect(f.source.start(KEY, METHOD)).toBe(true)
    f.authorize.push({ type: 'started', attemptId: ATTEMPT, key: OTHER_KEY, method: METHOD })
    await vi.waitFor(() => {
      expect(f.source.state.getSnapshot().attempt).toMatchObject({ phase: 'failed', failure: 'unavailable' })
    })
  })

  it('rejects a frame whose attempt id does not match the active stream', async () => {
    const f = fixture()
    await ready(f)
    expect(f.source.start(KEY, METHOD)).toBe(true)
    f.authorize.push({ type: 'started', attemptId: ATTEMPT, key: KEY, method: METHOD })
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().attempt?.phase).toBe('running') })
    f.authorize.push({
      type: 'prompt', attemptId: OTHER_ATTEMPT,
      prompt: { id: OTHER_PROMPT, kind: 'secret', message: 'Wrong attempt' },
    })
    await vi.waitFor(() => {
      expect(f.source.state.getSnapshot().attempt).toMatchObject({ phase: 'failed', prompt: null, failure: 'unavailable' })
    })
    f.authorize.push({ type: 'settled', attemptId: OTHER_ATTEMPT, status: 'authorized' })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(f.source.state.getSnapshot().attempt?.phase).toBe('failed')
  })

  it('maps cancel refusal and active transport failure without changing attempt ownership', async () => {
    const refused = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'account/in-flight', message: 'private remote detail', details: {} },
    })) as unknown as AccountRemote['cancel']
    const f = fixture({ cancel: refused })
    await prompted(f)
    await expect(f.source.cancel()).resolves.toBe(false)
    expect(f.source.state.getSnapshot()).toMatchObject({ actionError: 'in-flight' })

    const g = fixture({ cancel: vi.fn(() => Promise.reject(new Error('private transport detail'))) })
    await prompted(g)
    await expect(g.source.cancel()).resolves.toBe(false)
    expect(g.source.state.getSnapshot()).toMatchObject({ actionError: 'unavailable' })
  })

  it('ignores a cancel result after reconnection', async () => {
    type CancelResult = Awaited<ReturnType<AccountRemote['cancel']>>
    const pending = Promise.withResolvers<CancelResult>()
    const f = fixture({ cancel: vi.fn(() => pending.promise) })
    await prompted(f)

    const cancelling = f.source.cancel()
    f.source.connect(2)
    pending.resolve({ ok: true, value: false })
    await expect(cancelling).resolves.toBe(false)
  })

  it('contains an active deletion rejection and clears its reservation', async () => {
    const f = fixture({ deleteCredential: vi.fn(() => Promise.reject(new Error('private transport detail'))) })
    await ready(f)

    await expect(f.source.deleteCredential(KEY)).resolves.toBe(false)
    expect(f.source.state.getSnapshot()).toMatchObject({ pendingDeletion: null, actionError: 'unavailable' })
  })

  it.each(['starting', 'running'] as const)('marks an incomplete %s stream as failed', async (phase) => {
    const f = fixture()
    await ready(f)
    f.source.start(KEY, METHOD)
    if (phase === 'running') {
      f.authorize.push({ type: 'started', attemptId: ATTEMPT, key: KEY, method: METHOD })
      await vi.waitFor(() => { expect(f.source.state.getSnapshot().attempt?.phase).toBe('running') })
    }
    f.authorize.close()
    await vi.waitFor(() => {
      expect(f.source.state.getSnapshot().attempt).toMatchObject({ phase: 'failed', failure: 'unavailable' })
    })
  })

  it('maps an authorization stream rejection and accepts matching withdrawal and failure frames', async () => {
    const f = fixture()
    await prompted(f)
    f.authorize.push({ type: 'prompt-withdrawn', attemptId: ATTEMPT, promptId: PROMPT })
    f.authorize.push({
      type: 'settled', attemptId: ATTEMPT, status: 'failed', failure: 'network',
    })
    await vi.waitFor(() => {
      expect(f.source.state.getSnapshot().attempt).toMatchObject({ phase: 'failed', prompt: null, failure: 'network' })
    })
    f.source.dismissAttempt()
    f.authorize.push({ type: 'notice', attemptId: ATTEMPT, notice: { message: 'late notice' } })
    f.authorize.close()
    await vi.waitFor(() => {
      const authorization = (f.source as unknown as { authorization?: AbortController }).authorization
      expect(authorization).toBeUndefined()
    })
    expect(f.source.state.getSnapshot().attempt).toBeNull()
  })

  it('maps a current authorization stream failure to fixed feedback', async () => {
    const f = fixture()
    await ready(f)
    f.source.start(KEY, METHOD)
    f.authorize.fail(Object.assign(new Error('private stream detail'), { code: 'account/not-found' }))
    await vi.waitFor(() => {
      expect(f.source.state.getSnapshot()).toMatchObject({
        actionError: 'not-found', attempt: { phase: 'failed', failure: 'unavailable' },
      })
    })
  })

  it('marks a cleanly ended watch unavailable and ignores commands after disposal', async () => {
    const f = fixture()
    f.source.connect(1)
    f.watch.close()
    await vi.waitFor(() => { expect(f.source.state.getSnapshot()).toMatchObject({ status: 'error', readError: 'unavailable' }) })
    await f.source.dispose()

    f.source.connect(2)
    f.source.restart()
    expect(f.source.start(KEY, METHOD)).toBe(false)
    await expect(f.source.answer(PROMPT, 'answer')).resolves.toBe(false)
    await expect(f.source.cancel()).resolves.toBe(false)
    await expect(f.source.deleteCredential(KEY)).resolves.toBe(false)
    f.source.dismissAttempt()
    f.source.clearFeedback()
    await expect(f.source.dispose()).resolves.toBeUndefined()
  })

  it('ignores a unary result from an earlier connection generation', async () => {
    type DeleteResult = Awaited<ReturnType<AccountRemote['deleteCredential']>>
    let settleDeletion: ((result: DeleteResult) => void) | undefined
    const pendingDeletion = new Promise<DeleteResult>((resolve) => { settleDeletion = resolve })
    const f = fixture({ deleteCredential: vi.fn(() => pendingDeletion) })
    f.source.connect(1)
    f.watch.push(initial)
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().status).toBe('ready') })

    const deleting = f.source.deleteCredential(KEY)
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().pendingDeletion).toBe(KEY) })
    f.source.connect(2)
    settleDeletion?.({ ok: true, value: { localDeleted: true, issuerRevoked: false } })

    await expect(deleting).resolves.toBe(false)
    expect(f.source.state.getSnapshot()).toMatchObject({ pendingDeletion: null, deletedLocally: null })
  })

  it('disposes without waiting for a pending unary command and contains its late rejection', async () => {
    type DeleteResult = Awaited<ReturnType<AccountRemote['deleteCredential']>>
    const pendingDeletion = Promise.withResolvers<DeleteResult>()
    const f = fixture({ deleteCredential: vi.fn(() => pendingDeletion.promise) })
    f.source.connect(1)
    f.watch.push(initial)
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().status).toBe('ready') })

    const deleting = f.source.deleteCredential(KEY)
    await vi.waitFor(() => { expect(f.source.state.getSnapshot().pendingDeletion).toBe(KEY) })
    await expect(f.source.dispose()).resolves.toBeUndefined()
    pendingDeletion.reject(new Error('late unary rejection'))

    await expect(deleting).resolves.toBe(false)
    expect(f.source.state.getSnapshot().deletedLocally).toBeNull()
  })
})
