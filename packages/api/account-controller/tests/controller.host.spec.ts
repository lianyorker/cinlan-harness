import { Buffer } from 'node:buffer'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryCredentials } from '../../../credentials/authorization/tests/memory.ts'
import AccountController from '../src/index.ts'
import type {
  AccountAuthorizationAttemptId, AccountAuthorizationFrame, AccountAuthorizationMethodId,
  AccountAuthorizationPromptId, AccountAuthorizationPromptView,
} from '../src/types.ts'

const KEY = credentialKey('llm-pi-ai', 'sub2api')
const OTHER = credentialKey('llm-pi-ai', 'other')
const METHOD = 'password' as AccountAuthorizationMethodId
const MAX_SERIALIZED_FRAME_BYTES = 64 * 1_024
const MAX_SERIALIZED_SNAPSHOT_BYTES = 256 * 1_024
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function fixture() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(TypertRegistry)
  const controllerFiber = ctx.plugin(AccountController)
  await controllerFiber
  return { ctx, controller: ctx.accountController, controllerFiber }
}

async function passwordMethod(controller: AccountController) {
  const flow = (await controller.snapshot()).flows.find(candidate => candidate.key === KEY)
  const method = flow?.methods.find(candidate => candidate.id === 'password')
  if (method === undefined) throw new Error('missing password authorization method')
  return method.id
}

async function nextFrame(iterator: AsyncIterator<AccountAuthorizationFrame>): Promise<AccountAuthorizationFrame> {
  const next = await iterator.next()
  if (next.done || next.value === undefined) throw new Error('authorization stream ended before its next frame')
  return next.value
}

function nextAuthorizationFrame(
  controller: AccountController,
  key: typeof KEY,
  method: AccountAuthorizationMethodId,
  signal: AbortSignal,
): Promise<IteratorResult<AccountAuthorizationFrame>> {
  return controller.authorize(key, method, signal)[Symbol.asyncIterator]().next()
}

function promptFrom(frame: AccountAuthorizationFrame): AccountAuthorizationPromptView {
  if (frame.type !== 'prompt') throw new Error('expected a prompt frame')
  return frame.prompt
}

function currentPrompt(controller: AccountController): AccountAuthorizationPromptView | undefined {
  const attempts = (controller as unknown as {
    attempts: Map<unknown, { prompt?: { view: AccountAuthorizationPromptView } }>
  }).attempts
  return [...attempts.values()][0]?.prompt?.view
}

describe('AccountController', () => {
  it('lists late flows, relays prompts, keeps answers out of readback, and deletes only locally', async () => {
    const { ctx, controller } = await fixture()
    const watchAbort = new AbortController()
    const watch = controller.watch(watchAbort.signal)[Symbol.asyncIterator]()
    expect(await watch.next()).toMatchObject({ value: { flows: [] } })

    let password = ''
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Sub2API',
      methods: [{ id: 'password', label: 'Sign in with email and password' }],
      async run(session) {
        session.notify({ message: 'Contacting the account service' })
        await session.prompt({ kind: 'text', message: 'Email address', placeholder: 'person@example.test' })
        password = await session.prompt({ kind: 'secret', message: 'Password' })
        await ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'api-key', key: 'issuer-api-key' }))
        session.commit()
      },
    })
    expect((await watch.next()).value).toMatchObject({
      flows: [{ key: KEY, credential: { configured: false, writable: true }, inFlight: false }],
    })
    await ctx.credentials.modifyRecord(OTHER, () => Promise.resolve({ kind: 'api-key', key: 'other-key' }))

    const abort = new AbortController()
    const stream = controller.authorize(KEY, await passwordMethod(controller), abort.signal)[Symbol.asyncIterator]()
    const frames: AccountAuthorizationFrame[] = []
    frames.push(await nextFrame(stream))
    frames.push(await nextFrame(stream))
    const emailFrame = await nextFrame(stream)
    frames.push(emailFrame)
    const emailPrompt = promptFrom(emailFrame)
    if (emailPrompt.kind !== 'text') throw new Error('expected text prompt')
    expect(emailPrompt.placeholder).toBe('person@example.test')
    const attemptId = frames[0]?.attemptId
    if (attemptId === undefined) throw new Error('missing attempt identity')
    controller.answer(attemptId, emailPrompt.id, 'person@example.test')
    frames.push(await nextFrame(stream))

    const passwordFrame = await nextFrame(stream)
    frames.push(passwordFrame)
    const passwordPrompt = promptFrom(passwordFrame)
    expect(passwordPrompt.kind).toBe('secret')
    controller.answer(attemptId, passwordPrompt.id, 'private-password')
    frames.push(await nextFrame(stream))
    frames.push(await nextFrame(stream))
    expect(frames.at(-1)).toMatchObject({ type: 'settled', status: 'authorized' })
    expect(await stream.next()).toEqual({ done: true, value: undefined })
    expect(password).toBe('private-password')

    const snapshot = await controller.snapshot()
    expect(snapshot.flows[0]?.credential).toEqual({ configured: true, kind: 'api-key', writable: true })
    expect(JSON.stringify({ frames, snapshot })).not.toContain('private-password')
    expect(JSON.stringify(snapshot)).not.toContain('issuer-api-key')

    await vi.waitFor(async () => {
      expect((await watch.next()).value).toMatchObject({
        flows: [{ key: KEY, credential: { configured: true }, inFlight: false }],
      })
    })
    await expect(controller.deleteCredential(KEY)).resolves.toEqual({ localDeleted: true, issuerRevoked: false })
    expect(await ctx.credentials.readRecord(KEY)).toBeUndefined()
    expect((await controller.snapshot()).flows[0]?.credential.configured).toBe(false)
    watchAbort.abort()
  })

  it('rejects cancel and answer after settlement is queued but before stream cleanup', async () => {
    const { ctx, controller } = await fixture()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Sub2API',
      methods: [{ id: 'password', label: 'Sign in' }],
      async run(session) {
        void session.prompt({ kind: 'secret', message: 'Password' }).catch(() => undefined)
        await ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'api-key', key: 'stored' }))
        session.commit()
      },
    })
    const stream = controller.authorize(KEY, await passwordMethod(controller), new AbortController().signal)[Symbol.asyncIterator]()
    const started = await nextFrame(stream)
    const prompt = promptFrom(await nextFrame(stream))
    expect(await nextFrame(stream)).toMatchObject({ type: 'prompt-withdrawn', promptId: prompt.id })
    expect(await nextFrame(stream)).toMatchObject({ type: 'settled', status: 'authorized' })
    expect(controller.cancel(started.attemptId)).toBe(false)
    expect(() => { controller.answer(started.attemptId, prompt.id, 'late-answer') })
      .toThrow(expect.objectContaining({ code: 'account/stale-prompt' }))
    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined })
  })

  it('cancels an unresolved prompt even when the flow supplies no prompt-local signal', async () => {
    const { ctx, controller } = await fixture()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Sub2API',
      methods: [{ id: 'password', label: 'Sign in' }],
      async run(session) {
        await session.prompt({ kind: 'secret', message: 'Password' })
      },
    })
    const stream = controller.authorize(KEY, await passwordMethod(controller), new AbortController().signal)[Symbol.asyncIterator]()
    const started = await nextFrame(stream)
    const prompt = promptFrom(await nextFrame(stream))
    expect(controller.cancel(started.attemptId)).toBe(true)
    expect(await nextFrame(stream)).toEqual({
      type: 'prompt-withdrawn', attemptId: started.attemptId, promptId: prompt.id,
    })
    expect(await nextFrame(stream)).toEqual({
      type: 'settled', attemptId: started.attemptId, status: 'cancelled',
    })
    expect(await stream.next()).toEqual({ done: true, value: undefined })
    expect(controller.cancel(started.attemptId)).toBe(false)
  })

  it('serializes local deletion against controller-owned authorization attempts', async () => {
    const { ctx, controller } = await fixture()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Sub2API',
      methods: [{ id: 'password', label: 'Sign in' }],
      async run(session) {
        await session.prompt({ kind: 'secret', message: 'Password' })
        await ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'api-key', key: 'replacement' }))
        session.commit()
      },
    })
    await ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'api-key', key: 'existing' }))

    const describe = ctx.credentials.describeRecord.bind(ctx.credentials)
    const held = Promise.withResolvers<undefined>()
    vi.spyOn(ctx.credentials, 'describeRecord').mockImplementationOnce(async (key) => {
      await held.promise
      return describe(key)
    })
    const deleting = controller.deleteCredential(KEY)
    const blocked = controller.authorize(KEY, await passwordMethod(controller), new AbortController().signal)[Symbol.asyncIterator]()
    await expect(blocked.next()).rejects.toMatchObject({ code: 'account/in-flight' })
    held.resolve(undefined)
    await expect(deleting).resolves.toEqual({ localDeleted: true, issuerRevoked: false })

    const running = controller.authorize(KEY, await passwordMethod(controller), new AbortController().signal)[Symbol.asyncIterator]()
    const started = await nextFrame(running)
    await nextFrame(running)
    await expect(controller.deleteCredential(KEY)).rejects.toMatchObject({ code: 'account/in-flight' })
    controller.cancel(started.attemptId)
    await nextFrame(running)
    await nextFrame(running)
    await running.next()
  })

  it('serializes direct authorization against a pending local deletion', async () => {
    const { ctx, controller } = await fixture()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Sub2API',
      methods: [{ id: 'password', label: 'Sign in' }],
      async run(session) {
        await ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'api-key', key: 'replacement' }))
        session.commit()
      },
    })
    const describe = ctx.credentials.describeRecord.bind(ctx.credentials)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    vi.spyOn(ctx.credentials, 'describeRecord').mockImplementation(async (key) => {
      if (key === KEY) {
        entered.resolve(undefined)
        await release.promise
      }
      return describe(key)
    })

    const deleting = controller.deleteCredential(KEY)
    await entered.promise
    await expect(ctx.authorization.begin({
      key: KEY,
      interaction: { notify: () => {}, prompt: () => Promise.reject(new Error('unused')) },
    })).rejects.toMatchObject({ code: 'ALREADY_IN_FLIGHT' })
    release.resolve(undefined)
    await expect(deleting).resolves.toEqual({ localDeleted: false, issuerRevoked: false })
    await expect(ctx.authorization.begin({
      key: KEY,
      interaction: { notify: () => {}, prompt: () => Promise.reject(new Error('unused')) },
    })).resolves.toEqual({ status: 'authorized' })
  })

  it('keeps deletion blocked after caller cancellation until a non-cooperative flow settles', async () => {
    const { ctx, controller } = await fixture()
    const started = Promise.withResolvers<undefined>()
    const runner = Promise.withResolvers<undefined>()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Sub2API',
      methods: [{ id: 'password', label: 'Sign in' }],
      run: () => {
        started.resolve(undefined)
        return runner.promise
      },
    })
    const caller = new AbortController()
    const stream = controller.authorize(
      KEY, await passwordMethod(controller), caller.signal)[Symbol.asyncIterator]()
    expect(await nextFrame(stream)).toMatchObject({ type: 'started' })
    await started.promise
    caller.abort()

    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined })
    expect(ctx.authorization.describe(KEY)?.inFlight).toBe(true)
    await expect(controller.deleteCredential(KEY)).rejects.toMatchObject({ code: 'account/in-flight' })

    runner.resolve(undefined)
    await vi.waitFor(() => { expect(ctx.authorization.describe(KEY)?.inFlight).toBe(false) })
    await expect(controller.deleteCredential(KEY)).resolves.toEqual({ localDeleted: false, issuerRevoked: false })
  })

  it('omits unsafe provider notice URLs from the caller stream', async () => {
    const { ctx, controller } = await fixture()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Sub2API',
      methods: [{ id: 'password', label: 'Sign in' }],
      async run(session) {
        session.notify({ message: 'Unsafe continuation', url: 'javascript:alert(\'private-url-marker\')' })
        session.notify({ message: 'Malformed continuation', url: 'not a URL' })
        session.notify({ message: 'Username continuation', url: 'https://user@accounts.example.test/continue' })
        session.notify({ message: 'Password continuation', url: 'https://:secret@accounts.example.test/continue' })
        session.notify({ message: 'HTTP continuation', url: 'http://accounts.example.test/continue' })
        session.notify({
          message: 'Safe continuation', code: 'continue', url: 'https://accounts.example.test/continue',
        })
        await ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'api-key', key: 'stored' }))
        session.commit()
      },
    })
    const stream = controller.authorize(KEY, await passwordMethod(controller), new AbortController().signal)[Symbol.asyncIterator]()
    await nextFrame(stream)
    const unsafe = await nextFrame(stream)
    const malformed = await nextFrame(stream)
    const username = await nextFrame(stream)
    const password = await nextFrame(stream)
    const http = await nextFrame(stream)
    const safe = await nextFrame(stream)
    const settled = await nextFrame(stream)

    expect(unsafe).toMatchObject({ type: 'notice', notice: { message: 'Unsafe continuation' } })
    if (unsafe.type !== 'notice') throw new Error('expected unsafe notice frame')
    expect(unsafe.notice).not.toHaveProperty('url')
    for (const frame of [malformed, username, password]) {
      if (frame.type !== 'notice') throw new Error('expected filtered notice frame')
      expect(frame.notice).not.toHaveProperty('url')
    }
    expect(http).toMatchObject({
      type: 'notice', notice: { message: 'HTTP continuation', url: 'http://accounts.example.test/continue' },
    })
    expect(safe).toMatchObject({
      type: 'notice',
      notice: { message: 'Safe continuation', code: 'continue', url: 'https://accounts.example.test/continue' },
    })
    expect(settled).toMatchObject({ type: 'settled', status: 'authorized' })
    expect(JSON.stringify([unsafe, malformed, username, password, http, safe, settled])).not.toContain('javascript:')
  })

  it('projects fixed failures and never reflects rejected answer content', async () => {
    const { ctx, controller } = await fixture()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Sub2API',
      methods: [{ id: 'password', label: 'Sign in' }],
      async run(session) {
        const choice = await session.prompt({
          kind: 'select', message: 'Choose', options: [
            { id: 'allowed', label: 'Allowed', description: 'Continue with this account' },
            { id: 'other', label: 'Other' },
          ],
        })
        if (choice === 'allowed') throw Object.assign(new Error('sensitive-provider-message'), { code: 'SUB2API_REJECTED' })
      },
    })
    const stream = controller.authorize(KEY, await passwordMethod(controller), new AbortController().signal)[Symbol.asyncIterator]()
    const started = await nextFrame(stream)
    const prompt = promptFrom(await nextFrame(stream))
    let rejected: unknown
    try { controller.answer(started.attemptId, prompt.id, 'secret-invalid-choice') } catch (error) { rejected = error }
    expect(String(rejected)).not.toContain('secret-invalid-choice')
    expect(JSON.stringify(rejected)).not.toContain('secret-invalid-choice')
    controller.answer(started.attemptId, prompt.id, 'allowed')
    await nextFrame(stream)
    const settled = await nextFrame(stream)
    expect(settled).toMatchObject({ type: 'settled', status: 'failed', failure: 'rejected' })
    expect(JSON.stringify(settled)).not.toContain('sensitive-provider-message')
  })

  it('rejects invalid wire identities, missing flows, unavailable methods, and stale prompts', async () => {
    const { ctx, controller } = await fixture()
    const signal = new AbortController().signal
    const invalidKey = 'not-a-key' as typeof KEY
    await expect(nextAuthorizationFrame(controller, invalidKey, METHOD, signal))
      .rejects.toMatchObject({ code: 'account/bad-request' })
    await expect(nextAuthorizationFrame(controller, KEY, METHOD, signal))
      .rejects.toMatchObject({ code: 'account/not-found' })

    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Sub2API',
      methods: [{ id: 'password', label: 'Sign in' }],
      run: () => Promise.resolve(),
    })
    await expect(nextAuthorizationFrame(controller, KEY, 'unavailable' as AccountAuthorizationMethodId, signal))
      .rejects.toMatchObject({ code: 'account/not-found' })
    const attemptId = '11111111-1111-4111-8111-111111111111' as AccountAuthorizationAttemptId
    const promptId = '22222222-2222-4222-8222-222222222222' as AccountAuthorizationPromptId
    expect(() => { controller.answer(attemptId, promptId, 'answer') })
      .toThrow(expect.objectContaining({ code: 'account/stale-prompt' }))
  })

  it('reports read-only and failed local credential deletion without retaining its lock', async () => {
    const { ctx, controller } = await fixture()
    await expect(controller.deleteCredential(KEY)).rejects.toMatchObject({ code: 'account/not-found' })
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Sub2API',
      methods: [{ id: 'password', label: 'Sign in' }],
      run: () => Promise.resolve(),
    })
    vi.spyOn(ctx.credentials, 'describeRecord').mockResolvedValueOnce({
      configured: true, kind: 'api-key', writable: false,
    })
    await expect(controller.deleteCredential(KEY)).rejects.toMatchObject({ code: 'account/read-only' })

    await ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'api-key', key: 'existing' }))
    vi.spyOn(ctx.credentials, 'deleteRecord').mockRejectedValueOnce(new Error('filesystem detail'))
    await expect(controller.deleteCredential(KEY)).rejects.toMatchObject({ code: 'account/delete-failed' })
    await expect(controller.deleteCredential(KEY)).resolves.toEqual({ localDeleted: true, issuerRevoked: false })
  })

  it('withdraws a provider-signalled prompt with a fixed fallback reason', async () => {
    const { ctx, controller } = await fixture()
    const promptLifetime = new AbortController()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Sub2API',
      methods: [{ id: 'password', label: 'Sign in' }],
      async run(session) {
        await session.prompt({ kind: 'text', message: 'Email', signal: promptLifetime.signal })
      },
    })
    const stream = controller.authorize(KEY, await passwordMethod(controller), new AbortController().signal)[Symbol.asyncIterator]()
    const started = await nextFrame(stream)
    const prompt = promptFrom(await nextFrame(stream))
    promptLifetime.abort('provider withdrew')
    expect(await nextFrame(stream)).toEqual({
      type: 'prompt-withdrawn', attemptId: started.attemptId, promptId: prompt.id,
    })
    expect(await nextFrame(stream)).toMatchObject({ type: 'settled', status: 'failed', failure: 'unavailable' })
    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined })
  })

  it('fails a flow that requests concurrent prompts without exposing either answer', async () => {
    const { ctx, controller } = await fixture()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Sub2API',
      methods: [{ id: 'password', label: 'Sign in' }],
      async run(session) {
        await Promise.all([
          session.prompt({ kind: 'text', message: 'First prompt' }),
          session.prompt({ kind: 'secret', message: 'Second prompt' }),
        ])
      },
    })
    const stream = controller.authorize(KEY, await passwordMethod(controller), new AbortController().signal)[Symbol.asyncIterator]()
    await nextFrame(stream)
    const promptFrame = await nextFrame(stream)
    const prompt = promptFrom(promptFrame)
    expect(prompt).toMatchObject({ message: 'First prompt' })
    expect(await nextFrame(stream)).toMatchObject({ type: 'prompt-withdrawn', promptId: prompt.id })
    expect(await nextFrame(stream)).toMatchObject({ type: 'settled', status: 'failed', failure: 'unavailable' })
    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined })
  })

  it.each([
    ['ALREADY_IN_FLIGHT', 'busy'],
    ['SUB2API_INVALID_URL', 'invalid-input'],
    ['SUB2API_INVALID_INPUT', 'invalid-input'],
    ['SUB2API_NETWORK', 'network'],
    ['SUB2API_HTTP', 'rejected'],
    ['SUB2API_REJECTED', 'rejected'],
    ['SUB2API_INVALID_RESPONSE', 'invalid-response'],
    ['SUB2API_CLEANUP_FAILED', 'cleanup-failed'],
    ['NOT_COMMITTED', 'not-committed'],
    [null, 'unavailable'],
  ] as const)('maps provider failure %s to %s', async (code, failure) => {
    const { ctx, controller } = await fixture()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Sub2API',
      methods: [{ id: 'password', label: 'Sign in' }],
      async run() {
        if (code === null) throw null
        throw Object.assign(new Error('private provider detail'), { code })
      },
    })
    const stream = controller.authorize(KEY, await passwordMethod(controller), new AbortController().signal)[Symbol.asyncIterator]()
    await nextFrame(stream)
    expect(await nextFrame(stream)).toMatchObject({ type: 'settled', status: 'failed', failure })
    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined })
  })

  it('discards queued notices without dropping control settlement', async () => {
    const { ctx, controller } = await fixture()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Sub2API',
      methods: [{ id: 'password', label: 'Sign in' }],
      async run(session) {
        for (let index = 0; index < 32; index += 1) {
          session.notify({ message: 'Notice ' + String(index) })
        }
        await ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'api-key', key: 'stored' }))
        session.commit()
      },
    })
    const stream = controller.authorize(KEY, await passwordMethod(controller), new AbortController().signal)[Symbol.asyncIterator]()
    const frames: AccountAuthorizationFrame[] = []
    while (true) {
      const next = await stream.next()
      if (next.done) break
      frames.push(next.value)
    }
    expect(frames.filter(frame => frame.type === 'notice')).toHaveLength(31)
    expect(frames.at(-1)).toMatchObject({ type: 'settled', status: 'authorized' })
  })

  it('accepts an exact-size snapshot and rejects the complete value one byte over', async () => {
    const { ctx, controller } = await fixture()
    const emptyLabelSnapshot = {
      flows: [{
        key: KEY,
        label: '',
        methods: [{ id: 'password', label: 'Sign in' }],
        inFlight: false,
        credential: { configured: false, writable: true },
      }],
    }
    const overhead = Buffer.byteLength(JSON.stringify(emptyLabelSnapshot), 'utf8')
    const exactLabel = 'x'.repeat(MAX_SERIALIZED_SNAPSHOT_BYTES - overhead)
    const dispose = ctx.authorization.registerFlow({
      key: KEY,
      label: exactLabel,
      methods: [{ id: 'password', label: 'Sign in' }],
      run: () => Promise.resolve(),
    })

    const snapshot = await controller.snapshot()
    expect(Buffer.byteLength(JSON.stringify(snapshot), 'utf8')).toBe(MAX_SERIALIZED_SNAPSHOT_BYTES)

    dispose()
    ctx.authorization.registerFlow({
      key: KEY,
      label: exactLabel + 'x',
      methods: [{ id: 'password', label: 'Sign in' }],
      run: () => Promise.resolve(),
    })
    await expect(controller.snapshot()).rejects.toMatchObject({ code: 'account/output-limit' })
  })

  it('keeps an exact-size frame and drops an oversized multibyte notice', async () => {
    const { ctx, controller } = await fixture()
    const release = Promise.withResolvers<undefined>()
    let exactMessage = ''
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Sub2API',
      methods: [{ id: 'password', label: 'Sign in' }],
      async run(session) {
        await release.promise
        session.notify({ message: exactMessage })
        session.notify({ message: '界'.repeat(22_000) })
        await ctx.credentials.modifyRecord(KEY, () => Promise.resolve({ kind: 'api-key', key: 'stored' }))
        session.commit()
      },
    })
    const stream = controller.authorize(
      KEY, await passwordMethod(controller), new AbortController().signal)[Symbol.asyncIterator]()
    const started = await nextFrame(stream)
    if (started.type !== 'started') throw new Error('expected started frame')
    const emptyNotice = { type: 'notice', attemptId: started.attemptId, notice: { message: '' } } as const
    const overhead = Buffer.byteLength(JSON.stringify(emptyNotice), 'utf8')
    exactMessage = 'x'.repeat(MAX_SERIALIZED_FRAME_BYTES - overhead)
    release.resolve(undefined)

    const notice = await nextFrame(stream)
    expect(Buffer.byteLength(JSON.stringify(notice), 'utf8')).toBe(MAX_SERIALIZED_FRAME_BYTES)
    expect(notice).toMatchObject({ type: 'notice', notice: { message: exactMessage } })
    expect(await nextFrame(stream)).toMatchObject({ type: 'settled', status: 'authorized' })
    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined })
  })

  it('fails a stream on an oversized multibyte control frame', async () => {
    const { ctx, controller } = await fixture()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Sub2API',
      methods: [{ id: 'password', label: 'Sign in' }],
      async run(session) {
        await session.prompt({ kind: 'secret', message: '界'.repeat(22_000) })
      },
    })
    const stream = controller.authorize(
      KEY, await passwordMethod(controller), new AbortController().signal)[Symbol.asyncIterator]()
    expect(await nextFrame(stream)).toMatchObject({ type: 'started' })
    await expect(stream.next()).rejects.toMatchObject({ code: 'account/output-limit' })
  })

  it('retains 32 queued control frames and fails instead of evicting one more', async () => {
    const { ctx, controller } = await fixture()
    const requested = Array.from({ length: 17 }, () => Promise.withResolvers<undefined>())
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Sub2API',
      methods: [{ id: 'password', label: 'Sign in' }],
      async run(session) {
        for (let index = 0; index < requested.length; index += 1) {
          if (index === 16) session.notify({ message: 'This notice must not evict a control frame' })
          const pending = session.prompt({ kind: 'text', message: 'Prompt ' + String(index) })
          requested[index]?.resolve(undefined)
          await pending
        }
      },
    })
    const stream = controller.authorize(
      KEY, await passwordMethod(controller), new AbortController().signal)[Symbol.asyncIterator]()
    const started = await nextFrame(stream)
    if (started.type !== 'started') throw new Error('expected started frame')

    for (let index = 0; index < 16; index += 1) {
      await requested[index]?.promise
      const prompt = currentPrompt(controller)
      if (prompt === undefined) throw new Error('missing queued authorization prompt')
      controller.answer(started.attemptId, prompt.id, 'answer')
    }
    await requested[16]?.promise

    const queued: AccountAuthorizationFrame[] = []
    for (let index = 0; index < 32; index += 1) queued.push(await nextFrame(stream))
    expect(queued[0]).toMatchObject({ type: 'prompt', prompt: { message: 'Prompt 0' } })
    expect(queued.at(-1)).toMatchObject({ type: 'prompt-withdrawn' })
    await expect(stream.next()).rejects.toMatchObject({ code: 'account/output-limit' })
  })

  it('cleans paused authorization and watch streams when its fiber is disposed', async () => {
    const { ctx, controller, controllerFiber } = await fixture()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Sub2API',
      methods: [{ id: 'password', label: 'Sign in' }],
      async run(session) {
        await new Promise<void>((_resolve, reject) => {
          session.signal.addEventListener('abort', () => { reject(new Error('disposed')) }, { once: true })
        })
      },
    })
    const watch = controller.watch(new AbortController().signal)[Symbol.asyncIterator]()
    await watch.next()
    const authorize = controller.authorize(
      KEY, await passwordMethod(controller), new AbortController().signal)[Symbol.asyncIterator]()
    const started = await nextFrame(authorize)
    await vi.waitFor(() => { expect(ctx.authorization.describe(KEY)?.inFlight).toBe(true) })

    await controllerFiber.dispose()

    expect((controller as unknown as { attempts: Map<unknown, unknown> }).attempts.size).toBe(0)
    expect(ctx.authorization.describe(KEY)?.inFlight).toBe(false)
    await expect(authorize.next()).resolves.toEqual({ done: true, value: undefined })
    await expect(watch.next()).resolves.toEqual({ done: true, value: undefined })
    expect(started.type).toBe('started')
  })

  it('closes authorization and watch streams when its fiber is disposed', async () => {
    const { ctx, controller, controllerFiber } = await fixture()
    ctx.authorization.registerFlow({
      key: KEY,
      label: 'Sub2API',
      methods: [{ id: 'password', label: 'Sign in' }],
      async run(session) {
        await session.prompt({ kind: 'secret', message: 'Password' })
      },
    })
    const authorize = controller.authorize(KEY, await passwordMethod(controller), new AbortController().signal)[Symbol.asyncIterator]()
    await nextFrame(authorize)
    await nextFrame(authorize)
    const authorizationWaiting = authorize.next()
    const watch = controller.watch(new AbortController().signal)[Symbol.asyncIterator]()
    await watch.next()
    const watchWaiting = watch.next()
    await controllerFiber.dispose()
    await expect(authorizationWaiting).resolves.toEqual({ done: true, value: undefined })
    await expect(watchWaiting).resolves.toEqual({ done: true, value: undefined })
  })
})
