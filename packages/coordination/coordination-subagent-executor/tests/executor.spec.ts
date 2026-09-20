import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { TaskId } from '@deepseek-ai/dsh-coordination'
import LocalCoordinationService from '@deepseek-ai/dsh-coordination-local'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as subagent from '@deepseek-ai/dsh-subagent'
import type {
  ResolvedSubagentStartRequest, SubagentCapabilities, SubagentProvider, SubagentResult, SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import * as executor from '@deepseek-ai/dsh-coordination-subagent-executor'

const ALL_CAPABILITIES: SubagentCapabilities = {
  agentOptions: true,
  outputSchema: true,
  depthLimit: true,
  toolFilter: true,
  persona: true,
}

function fakeAgent(ctx: Context, id: string): Agent {
  const sessionId = SessionId(id)
  return {
    id: sessionId,
    ctx,
    status: 'idle',
    session: { id: sessionId, header: {} },
  } as unknown as Agent
}

class StubProvider implements SubagentProvider {
  readonly name = 'stub'
  readonly inheritsParentContext = false
  readonly requests: ResolvedSubagentStartRequest[] = []
  disposeCount = 0

  constructor(
    readonly capabilities: SubagentCapabilities = ALL_CAPABILITIES,
    private readonly resultFor: (request: ResolvedSubagentStartRequest) => Promise<SubagentResult> =
      request => Promise.resolve({
        output: [{ type: 'text', text: `answer:${request.label}` }],
        stopReason: 'completed',
      }),
  ) {}

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    this.requests.push(request)
    const index = this.requests.length
    return {
      id: SessionId(`child-${index}`),
      localAgent: undefined,
      result: this.resultFor(request),
      dispose: async () => { this.disposeCount += 1 },
    }
  }
}

async function setup(provider = new StubProvider(), config: Partial<executor.Config> = {}) {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(LocalCoordinationService, { maxConcurrency: 4 })
  const removeProvider = ctx.subagents.registerProvider(provider)
  const parent = fakeAgent(ctx, 'parent')
  const removeParent = await ctx.agents.register(parent)
  const fiber = await ctx.plugin(executor, { provider: 'stub', ...config })
  return { ctx, provider, parent, removeParent, removeProvider, fiber }
}

function input(prompt: string, parentAgentId = 'parent') {
  return { prompt, parentAgentId }
}

describe('coordination subagent executor', () => {
  it('runs a DAG through one-shot subagents and passes bounded dependency results to successors', async () => {
    const { ctx, provider } = await setup()
    const run = ctx.coordination.start({ tasks: [
      { id: TaskId('research'), label: 'Research', executor: 'subagent', input: input('find facts') },
      {
        id: TaskId('review'),
        label: 'Review',
        executor: 'subagent',
        dependencies: [TaskId('research')],
        input: input('review the result'),
      },
    ] })

    await expect(run.result).resolves.toMatchObject({ status: 'succeeded' })
    expect(provider.requests).toHaveLength(2)
    expect(provider.requests[0]).toMatchObject({ label: 'Research', parent: { id: SessionId('parent') } })
    const successorPrompt = provider.requests[1]?.prompt[0]
    expect(successorPrompt).toMatchObject({ type: 'text' })
    if (successorPrompt?.type !== 'text') throw new Error('expected successor text prompt')
    expect(successorPrompt.text).toContain('review the result')
    expect(successorPrompt.text).toContain('Completed dependency results follow')
    expect(successorPrompt.text).toContain('answer:Research')
    expect(ctx.coordination.getTask(TaskId('review')).output).toEqual({
      subagentId: 'child-2', text: 'answer:Review',
    })
    expect(provider.disposeCount).toBe(2)
    await ctx.fiber.dispose()
  })

  it('describes missing and non-JSON dependency outputs and truncates oversized context', async () => {
    const { ctx, provider } = await setup(new StubProvider(), { maxDependencyContextChars: 40 })
    ctx.coordination.registerExecutor('no-output', () => ({ status: 'succeeded' }))
    ctx.coordination.registerExecutor('non-json', () => ({ status: 'succeeded', output: 1n }))
    const run = ctx.coordination.start({ tasks: [
      { id: TaskId('empty'), label: 'empty', executor: 'no-output' },
      { id: TaskId('bigint'), label: 'bigint', executor: 'non-json' },
      {
        id: TaskId('consumer'),
        label: 'consumer',
        executor: 'subagent',
        dependencies: [TaskId('empty'), TaskId('bigint')],
        input: input('use dependencies'),
      },
    ] })

    await expect(run.result).resolves.toMatchObject({ status: 'succeeded' })
    const prompt = provider.requests[0]?.prompt[0]
    if (prompt?.type !== 'text') throw new Error('expected text prompt')
    expect(prompt.text).toContain('(no output)')
    expect(prompt.text).toContain('[dependency results truncated]')

    const full = await setup()
    full.ctx.coordination.registerExecutor('non-json', () => ({ status: 'succeeded', output: 1n }))
    const fullRun = full.ctx.coordination.start({ tasks: [
      { id: TaskId('full-bigint'), label: 'bigint', executor: 'non-json' },
      {
        id: TaskId('full-consumer'), label: 'consumer', executor: 'subagent',
        dependencies: [TaskId('full-bigint')], input: input('use dependency'),
      },
    ] })
    await fullRun.result
    const fullPrompt = full.provider.requests[0]?.prompt[0]
    if (fullPrompt?.type !== 'text') throw new Error('expected text prompt')
    expect(fullPrompt.text).toContain('(output is not lossless JSON)')
    await full.ctx.fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('passes every configured child option and supports provider-managed depth', async () => {
    const { ctx, provider } = await setup(new StubProvider(), {
      agentOptions: { provider: 'deepseek', model: 'model', maxTokens: 123 },
      persona: 'reviewer',
      toolFilter: { allow: ['read'] },
      maxDepth: 'provider-managed',
    })
    const run = ctx.coordination.start({ tasks: [
      { id: TaskId('configured'), label: 'Configured', executor: 'subagent', input: input('run') },
    ] })
    await run.result
    expect(provider.requests[0]).toMatchObject({
      agentOptions: { provider: 'deepseek', model: 'model', maxTokens: 123 },
      persona: 'reviewer',
      toolFilter: { allow: ['read'] },
    })
    expect(provider.requests[0]).not.toHaveProperty('maxDepth')
    await ctx.fiber.dispose()
  })

  it('mirrors provider availability into executor registration and releases it on plugin disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalCoordinationService, { maxConcurrency: 1 })
    const parent = fakeAgent(ctx, 'parent')
    await ctx.agents.register(parent)
    const fiber = await ctx.plugin(executor, { provider: 'stub' })

    expect(() => ctx.coordination.start({ tasks: [
      { label: 'missing', executor: 'subagent', input: input('x') },
    ] })).toThrow(/unavailable/)

    const provider = new StubProvider()
    const removeProvider = ctx.subagents.registerProvider(provider)
    ctx.emit('subagent/provider-added', {
      name: 'other',
      inheritsParentContext: false,
      capabilities: ALL_CAPABILITIES,
      start: request => provider.start(request),
    })
    ctx.emit('subagent/provider-added', provider)
    ctx.emit('subagent/provider-removed', 'other')
    await expect(ctx.coordination.start({ tasks: [
      { label: 'present', executor: 'subagent', input: input('x') },
    ] }).result).resolves.toMatchObject({ status: 'succeeded' })

    removeProvider()
    expect(() => ctx.coordination.start({ tasks: [
      { label: 'removed', executor: 'subagent', input: input('x') },
    ] })).toThrow(/unavailable/)

    ctx.subagents.registerProvider(provider)
    await fiber.dispose()
    expect(() => ctx.coordination.start({ tasks: [
      { label: 'disposed', executor: 'subagent', input: input('x') },
    ] })).toThrow(/unavailable/)
    await ctx.fiber.dispose()
  })

  it('fails malformed inputs and missing live parents without publishing subagents', async () => {
    const { ctx, provider, removeParent } = await setup()
    const malformed = ctx.coordination.start({ tasks: [
      { id: TaskId('primitive'), label: 'Primitive', executor: 'subagent', input: 'bad' },
      { id: TaskId('null'), label: 'Null', executor: 'subagent', input: null },
      { id: TaskId('array'), label: 'Array', executor: 'subagent', input: [] },
      { id: TaskId('missing-prompt'), label: 'Missing prompt', executor: 'subagent', input: { parentAgentId: 'parent' } },
      { id: TaskId('empty-prompt'), label: 'Empty prompt', executor: 'subagent', input: { prompt: '', parentAgentId: 'parent' } },
      { id: TaskId('missing-parent-id'), label: 'Missing parent id', executor: 'subagent', input: { prompt: 'x' } },
      { id: TaskId('empty-parent-id'), label: 'Empty parent id', executor: 'subagent', input: { prompt: 'x', parentAgentId: '' } },
    ] })
    await expect(malformed.result).resolves.toMatchObject({ status: 'failed' })
    for (const id of ['primitive', 'null', 'array']) {
      expect(ctx.coordination.getTask(TaskId(id)).error).toContain('object input')
    }
    for (const id of ['missing-prompt', 'empty-prompt']) {
      expect(ctx.coordination.getTask(TaskId(id)).error).toContain('non-empty prompt')
    }
    for (const id of ['missing-parent-id', 'empty-parent-id']) {
      expect(ctx.coordination.getTask(TaskId(id)).error).toContain('parentAgentId')
    }

    await removeParent()
    const missing = ctx.coordination.start({ tasks: [
      { id: TaskId('missing-parent'), label: 'Missing', executor: 'subagent', input: input('x') },
    ] })
    await expect(missing.result).resolves.toMatchObject({ status: 'failed' })
    expect(ctx.coordination.getTask(TaskId('missing-parent')).error).toContain('is unavailable')
    expect(provider.requests).toHaveLength(0)
    await ctx.fiber.dispose()
  })

  it('maps child failure and cancellation to coordination terminal states', async () => {
    const provider = new StubProvider(ALL_CAPABILITIES, request => request.label === 'Fail'
      ? Promise.resolve({ output: [], stopReason: 'max-tokens' })
      : new Promise((resolve) => {
        request.signal.addEventListener('abort', () => {
          resolve({ output: [], stopReason: 'aborted' })
        }, { once: true })
      }))
    const { ctx } = await setup(provider)
    const failed = ctx.coordination.start({ tasks: [
      { id: TaskId('failed'), label: 'Fail', executor: 'subagent', input: input('x') },
    ] })
    await expect(failed.result).resolves.toMatchObject({ status: 'failed' })
    expect(ctx.coordination.getTask(TaskId('failed'))).toMatchObject({ status: 'failed', error: 'max-tokens' })

    const cancelled = ctx.coordination.start({ tasks: [
      { id: TaskId('cancelled'), label: 'Wait', executor: 'subagent', input: input('x') },
    ] })
    await new Promise<void>((resolve) => { queueMicrotask(resolve) })
    cancelled.cancel('stop')
    await expect(cancelled.result).resolves.toMatchObject({ status: 'cancelled' })
    expect(ctx.coordination.getTask(TaskId('cancelled')).status).toBe('cancelled')
    await ctx.fiber.dispose()
  })

  it('maps optional settlement output and detail fields without inventing data', async () => {
    const settle = vi.spyOn(subagent, 'settleRun')
    const { ctx } = await setup()
    for (const [id, outcome, expected] of [
      ['empty-completed', { status: 'completed' }, { status: 'succeeded', output: { subagentId: 'child-1', text: '' } }],
      ['killed-detail', { status: 'killed', detail: 'provider stopped' }, { status: 'cancelled', error: 'provider stopped' }],
      ['failed-empty', { status: 'failed' }, { status: 'failed', error: 'subagent run failed' }],
    ] as const) {
      settle.mockResolvedValueOnce(outcome)
      const run = ctx.coordination.start({ tasks: [
        { id: TaskId(id), label: id, executor: 'subagent', input: input('x') },
      ] })
      await run.result
      expect(ctx.coordination.getTask(TaskId(id))).toMatchObject(expected)
    }
    settle.mockRestore()
    await ctx.fiber.dispose()
  })

  it('rejects unsupported provider capabilities and invalid direct configuration', async () => {
    const unsupported: [SubagentCapabilities, Partial<executor.Config>, RegExp][] = [
      [{ ...ALL_CAPABILITIES, depthLimit: false }, {}, /cannot enforce maxDepth/],
      [{ ...ALL_CAPABILITIES, persona: false }, { persona: 'reviewer' }, /does not support persona/],
      [{ ...ALL_CAPABILITIES, toolFilter: false }, { toolFilter: { deny: ['bash'] } }, /does not support toolFilter/],
    ]
    for (const [capabilities, config, message] of unsupported) {
      const current = new Context()
      await current.plugin(AgentRegistry)
      await current.plugin(SubagentRuntime)
      await current.plugin(LocalCoordinationService, { maxConcurrency: 1 })
      current.subagents.registerProvider(new StubProvider(capabilities))
      await expect(current.plugin(executor, { provider: 'stub', ...config })).rejects.toThrow(message)
      await current.fiber.dispose()
    }

    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(LocalCoordinationService, { maxConcurrency: 1 })
    expect(() => { executor.apply(ctx, { provider: ' ' }) }).toThrow(/provider must be non-empty/)
    expect(() => { executor.apply(ctx, { provider: 'stub', executorKind: ' ' }) }).toThrow(/executorKind must be non-empty/)
    expect(() => { executor.apply(ctx, { provider: 'stub', maxDependencyContextChars: 0 }) }).toThrow(/positive safe integer/)
    expect(() => { executor.apply(ctx, { provider: 'stub', maxDependencyContextChars: 1.5 }) }).toThrow(/positive safe integer/)
    expect(() => { executor.apply(ctx, { provider: 'stub', toolFilter: {} }) }).toThrow(/allow or deny/)
    executor.apply(ctx, { provider: 'missing' })
    await ctx.fiber.dispose()
  })

})
