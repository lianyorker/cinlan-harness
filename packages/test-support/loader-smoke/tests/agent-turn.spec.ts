import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { runFixtureTurn } from '../src/agent-turn.ts'

type Listener = (session: unknown, event: SessionEvent) => void

const event = (value: object): SessionEvent => value as unknown as SessionEvent

function turnHarness(): {
  readonly ctx: Context
  readonly session: { readonly id: string }
  readonly foreignSession: object
  readonly emit: (session: unknown, value: object) => void
  readonly setFollowup: (callback: (message: { readonly id: unknown }) => void) => void
  readonly whenIdle: ReturnType<typeof vi.fn>
  readonly disposeListener: ReturnType<typeof vi.fn>
  readonly flush: ReturnType<typeof vi.fn>
} {
  const session = { id: 'fixture-session' }
  const foreignSession = {}
  let listener: Listener | undefined
  let followup = (_message: { readonly id: unknown }): void => {}
  const whenIdle = vi.fn(async () => {})
  const disposeListener = vi.fn()
  const flush = vi.fn(async () => {})
  const agent = {
    session,
    whenIdle,
    followup: vi.fn((message: { readonly id: unknown }) => { followup(message) }),
  }
  const ctx = {
    get: (name: string) => name === 'agents' ? { roots: () => [agent] } : undefined,
    on: (_name: string, callback: Listener) => {
      listener = callback
      return disposeListener
    },
    sessions: { flush },
  } as unknown as Context
  return {
    ctx,
    session,
    foreignSession,
    emit: (target, value) => { listener?.(target, event(value)) },
    setFollowup: (callback) => { followup = callback },
    whenIdle,
    disposeListener,
    flush,
  }
}

describe('runFixtureTurn', () => {
  it.each([
    ['no agent registry', undefined, 0],
    ['multiple roots', { roots: () => [{}, {}] }, 2],
  ])('rejects %s', async (_label, registry, count) => {
    const ctx = { get: () => registry, on: () => () => {} } as unknown as Context
    await expect(runFixtureTurn(ctx, { task: 'ignored' }))
      .rejects.toThrow(`fixture turn requires exactly one top-level agent, found ${count}`)
  })

  it('rechecks the root count after successful startup', async () => {
    const roots: object[] = []
    let started: ((payload: { agent: object }) => void) | undefined
    const dispose = vi.fn()
    const ctx = {
      get: (name: string) => name === 'agents' ? { roots: () => [...roots] } : undefined,
      on: (name: string, callback: (payload: { agent: object }) => void) => {
        if (name === 'agent/session-start') started = callback
        return dispose
      },
    } as unknown as Context
    const pending = runFixtureTurn(ctx, { task: 'ignored' })
    roots.push({}, {})
    started?.({ agent: roots[0]! })
    await expect(pending).rejects.toThrow('fixture turn requires exactly one top-level agent, found 2')
    expect(dispose).toHaveBeenCalledTimes(3)
  })

  it('rejects an already-aborted publication wait without installing listeners', async () => {
    const failure = new Error('fixture stopped')
    const on = vi.fn()
    const ctx = { on } as unknown as Context
    await expect(runFixtureTurn(ctx, { task: 'ignored', signal: AbortSignal.abort(failure) }))
      .rejects.toBe(failure)
    expect(on).not.toHaveBeenCalled()
  })

  it('aborts an unpublished agent wait and awaits every listener teardown', async () => {
    const controller = new AbortController()
    const failure = new Error('fixture cancelled')
    const cleanupEntered = Promise.withResolvers<undefined>()
    const cleanupReleased = Promise.withResolvers<undefined>()
    const dispose = vi.fn(async () => {
      cleanupEntered.resolve(undefined)
      await cleanupReleased.promise
    })
    const on = vi.fn(() => dispose)
    const ctx = { get: () => ({ roots: () => [] }), on } as unknown as Context
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const pending = runFixtureTurn(ctx, { task: 'ignored', signal: controller.signal })
    let settled = false
    const outcome = pending.then(
      () => { settled = true; return undefined },
      (error: unknown) => { settled = true; return error },
    )
    try {
      controller.abort(failure)
      await cleanupEntered.promise
      expect(settled).toBe(false)
      expect(dispose).toHaveBeenCalledTimes(3)
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
      cleanupReleased.resolve(undefined)
      await expect(outcome).resolves.toBe(failure)
    } finally {
      cleanupReleased.resolve(undefined)
      await outcome
      remove.mockRestore()
    }
  })

  it('reports listener teardown failures from a cancelled publication wait', async () => {
    const controller = new AbortController()
    const failure = new Error('waiter cleanup failed')
    const entered = Promise.withResolvers<undefined>()
    const released = Promise.withResolvers<undefined>()
    const dispose = vi.fn(async (): Promise<void> => { throw failure })
      .mockImplementationOnce(async () => {
        entered.resolve(undefined)
        await released.promise
      })
    const ctx = {
      get: () => ({ roots: () => [] }),
      on: () => dispose,
    } as unknown as Context
    const pending = runFixtureTurn(ctx, { task: 'ignored', signal: controller.signal })
    let settled = false
    const outcome = pending.then(
      () => { settled = true; return undefined },
      (error: unknown) => { settled = true; return error },
    )
    try {
      controller.abort(new Error('fixture cancelled'))
      await entered.promise
      expect(settled).toBe(false)
      expect(dispose).toHaveBeenCalledTimes(3)
      released.resolve(undefined)
      await expect(outcome).resolves.toMatchObject({
        message: 'fixture startup listener cleanup failed', errors: [failure, failure],
      })
    } finally {
      released.resolve(undefined)
      await outcome
    }
  })

  it.each([false, true])('waits for all creation listeners before submitting (failure=%s)', async (fails) => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    const session = ctx.sessions.create(SessionId('waiter-agent'))
    const followup = vi.fn()
    const agent = {
      id: session.id, session, ctx,
      followup, whenIdle: () => Promise.resolve(),
    } as unknown as Agent
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const controller = new AbortController()
    const pending = runFixtureTurn(ctx, { task: 'fixture task', signal: controller.signal })
    const outcome = pending.then(value => value, (error: unknown) => error)
    const stopLater = ctx.on('agent/created', async () => {
      entered.resolve(undefined)
      await release.promise
      if (fails) throw new Error('later creation failed')
    })
    const registration = ctx.agents.register(agent)
    const registered = Promise.resolve(registration).then(value => value, (error: unknown) => error)
    try {
      await entered.promise
      expect(followup).not.toHaveBeenCalled()
      release.resolve(undefined)
      if (fails) {
        await expect(registered).resolves.toMatchObject({ message: 'later creation failed' })
        await expect(outcome).resolves.toMatchObject({ message: 'fixture agent "waiter-agent" was disposed before startup completed' })
        expect(followup).not.toHaveBeenCalled()
      } else {
        await registered
        ctx.emit('agent/session-start', { agent, source: 'startup' })
        await expect(outcome).resolves.toMatchObject({ type: 'result', sessionId: session.id })
        expect(followup).toHaveBeenCalledOnce()
      }
    } finally {
      release.resolve(undefined)
      controller.abort(new Error('fixture teardown'))
      await outcome
      await registered
      if (fails) await expect(Promise.resolve(registration())).rejects.toThrow('later creation failed')
      else await registration()
      stopLater()
      await ctx.fiber.dispose()
    }
  })

  it('observes only the owned interval and returns its final text and deduplicated usage', async () => {
    const harness = turnHarness()
    const observed: SessionEvent[] = []
    harness.setFollowup((message) => {
      harness.emit(harness.foreignSession, {
        type: 'assistant/message', seq: 0, time: 0, data: { stream: [], message: { content: [] } },
      })
      harness.emit(harness.session, {
        type: 'step/start', seq: 0, time: 0, data: { turn: 1, step: 1 },
      })
      harness.emit(harness.session, {
        type: 'agent/inbox/spliced', seq: 1, time: 1, data: { inserted: [{ id: 'other' }] },
      })
      harness.emit(harness.session, {
        type: 'agent/inbox/spliced', seq: 2, time: 2, data: { inserted: [message] },
      })
      harness.emit(harness.session, {
        type: 'assistant/attempt', seq: 3, time: 3,
        data: {
          turn: 1,
          step: 1,
          stream: [
            { type: 'text-chunks', time0: 3, index: 0, dt: [], texts: ['partial'] },
            {
              type: 'chunk', time: 4,
              chunk: {
                type: 'usage', usage: { inputTokens: 2, outputTokens: 3, reasoningTokens: 1 },
              },
            },
          ],
        },
      })
      harness.emit(harness.session, {
        type: 'feedback/record', seq: 4, time: 4, data: { text: 'interleaved' },
      })
      harness.emit(harness.session, {
        type: 'assistant/message', seq: 5, time: 5,
        data: {
          turn: 1,
          step: 1,
          stream: [],
          message: { content: [{ type: 'text', text: 'final answer' }] },
          usage: { inputTokens: 4, outputTokens: 5, cacheReadTokens: 6 },
        },
      })
      harness.emit(harness.session, {
        type: 'assistant/attempt', seq: 6, time: 6,
        data: {
          turn: 1,
          step: 2,
          stream: [{
            type: 'chunk', time: 6,
            chunk: {
              type: 'usage',
              usage: { inputTokens: 1, outputTokens: 2, cacheWriteTokens: 7, reasoningTokens: 2 },
            },
          }],
        },
      })
      harness.emit(harness.session, {
        type: 'assistant/message', seq: 7, time: 7,
        data: { turn: 1, step: 2, stream: [], message: { content: [{ type: 'tool-call' }] } },
      })
      harness.emit(harness.session, {
        type: 'assistant/attempt', seq: 8, time: 8,
        data: {
          turn: 1,
          step: 3,
          stream: [{ type: 'text-chunks', time0: 8, index: 0, dt: [], texts: ['no usage'] }],
        },
      })
      harness.emit(harness.foreignSession, {
        type: 'assistant/message', seq: 9, time: 9, data: { stream: [], message: { content: [] } },
      })
    })

    await expect(runFixtureTurn(harness.ctx, {
      task: 'prove the fixture',
      onEvent: (_sessionId, current) => { observed.push(current) },
    })).resolves.toEqual({
      type: 'result',
      sessionId: 'fixture-session',
      output: 'final answer',
      usage: {
        inputTokens: 5,
        outputTokens: 7,
        cacheReadTokens: 6,
        cacheWriteTokens: 7,
        reasoningTokens: 2,
      },
    })
    expect(observed.map(current => current.seq)).toEqual([2, 3, 4, 5, 6, 7, 8])
    expect(harness.whenIdle).toHaveBeenCalledTimes(2)
    expect(harness.flush).toHaveBeenCalledWith(harness.session)
    expect(harness.disposeListener).toHaveBeenCalledOnce()
  })

  it('omits usage when the interval records none', async () => {
    const harness = turnHarness()
    harness.setFollowup((message) => {
      harness.emit(harness.session, {
        type: 'agent/inbox/spliced', seq: 0, time: 0, data: { inserted: [message] },
      })
    })

    await expect(runFixtureTurn(harness.ctx, { task: 'no model step' })).resolves.toEqual({
      type: 'result',
      sessionId: 'fixture-session',
      output: '',
    })
  })

  it('always removes its listener when the turn fails', async () => {
    const harness = turnHarness()
    harness.whenIdle.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('turn failed'))

    await expect(runFixtureTurn(harness.ctx, { task: 'fail' })).rejects.toThrow('turn failed')
    expect(harness.disposeListener).toHaveBeenCalledOnce()
    expect(harness.flush).not.toHaveBeenCalled()
  })
})
