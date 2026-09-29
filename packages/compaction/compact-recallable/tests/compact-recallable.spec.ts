import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { RecallableCompactionEngine, findOpenTurn } from '@deepseek-ai/dsh-compact-recallable'
import {
  findLastCommittedIndexCheckpoint,
  isRecalledOnlySpan,
  isRecallToolEvent,
  selectPartitionPlan,
} from '@deepseek-ai/dsh-compact-recallable/src/chunking.ts'
import {
  resolveCompactSpec,
  resolveConfig,
  resolveTargetPolicy,
  TargetPressureConfigError,
} from '@deepseek-ai/dsh-compact-recallable/src/config.ts'
import { summarizeChunk, summarizeState } from '@deepseek-ai/dsh-compact-recallable/src/summarizer.ts'
import LlmRuntime, {
  createUserMessage,
  createSystemMessage,
  createToolResultMessage,
  createMessage,
  CONTEXT_WINDOW_EXCEEDED_CODE,
  LlmAdapter,
} from '@deepseek-ai/dsh-llm'
import type {
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CommandId } from '@deepseek-ai/dsh-commands/brand'
import { CHECKPOINT_FOOTER_RE, CompactionId, compactCheckpointSource } from '@deepseek-ai/dsh-compaction'

const MODEL = 'test-model'
const SIGNAL = new AbortController().signal

class MockLlmAdapter extends LlmAdapter {
  constructor(
    private readonly contextWindow = 10_000,
    private readonly outputText = 'Chunk summary of conversation\nKeywords: foo; bar; baz',
    private readonly shouldFail = false,
    private readonly usage?: { inputTokens: number; outputTokens: number },
  ) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      context: { contextWindow: this.contextWindow },
    })
  }

  override async * stream(): AsyncIterable<StreamChunk> {
    if (this.shouldFail) {
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { message: 'simulated LLM stream error', code: 'STREAM_ERROR' } },
      }
      return
    }
    yield { type: 'text-delta', index: 0, text: this.outputText }
    if (this.usage !== undefined) {
      yield { type: 'usage', usage: this.usage }
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function createContext(
  contextWindow = 10_000,
  outputText?: string,
  shouldFail = false,
  usage?: { inputTokens: number; outputTokens: number },
): Context {
  const ctx = new Context()
  void new LlmRuntime(ctx)
  new SessionProjectionRegistry(ctx)
  void new TokenMeter(ctx)
  ctx.llm.registerAdapter([MODEL, 'default'], new MockLlmAdapter(contextWindow, outputText, shouldFail, usage))
  return ctx
}

function createAgent(session: Session, model = MODEL): Agent {
  return {
    session,
    options: { provider: model, model },
    status: 'idle',
    reserveTurnAdmission: () => () => undefined,
    runMaintenance: <T>(task: (sig: AbortSignal) => Promise<T>) => task(SIGNAL),
  } as unknown as Agent
}

function appendSystem(session: Session, text = 'System prompt') {
  return session.append('system/message', {
    turn: 1,
    step: 1,
    message: createSystemMessage(text, 'system-prompt'),
  }, { surfaceOp: 'append' })
}

function appendUser(session: Session, text: string, _turn = 1) {
  return session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

function appendAssistant(session: Session, text: string, turn = 1) {
  if (turn === 1 && !session.requestHeader()) {
    session.append('request/header', {
      header: { config: { provider: MODEL, model: MODEL } },
      reason: 'initial',
    })
  }
  session.append('step/start', { turn, step: 1 })
  return session.append('assistant/message', {
    turn,
    step: 1,
    stream: [],
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text }],
      source: { kind: 'model', provider: MODEL, model: MODEL },
    }),
  }, { surfaceOp: 'append' })
}

describe('RecallableCompactionConfig & validation', () => {
  it('resolves valid default config', () => {
    const config = resolveConfig()
    expect(config.thresholdRatio).toBe(0.8)
    expect(config.retainRatio).toBe(0.16)
    expect(config.chunkTokens).toBe(4000)
    expect(config.stubTokens).toBe(200)
    expect(config.maxTokens).toBe(8192)
    expect(config.auto).toBe(true)
  })

  it('rejects unknown configuration keys', () => {
    expect(() => resolveConfig({ unknownKey: 123 } as never)).toThrow(/unknown key "unknownKey"/)
  })

  it('rejects invalid thresholdRatio', () => {
    expect(() => resolveConfig({ thresholdRatio: 0 })).toThrow(/thresholdRatio must sit in \(0, 1\]/)
    expect(() => resolveConfig({ thresholdRatio: 1.5 })).toThrow(/thresholdRatio must sit in \(0, 1\]/)
  })

  it('rejects invalid retainRatio or retainRatio >= thresholdRatio', () => {
    expect(() => resolveConfig({ retainRatio: 0 })).toThrow(/retainRatio must sit in \(0, 1\)/)
    expect(() => resolveConfig({ thresholdRatio: 0.5, retainRatio: 0.6 })).toThrow(/retainRatio .* must sit strictly below thresholdRatio/)
  })

  it('rejects specifying both retainRatio and retainTokens', () => {
    expect(() => resolveConfig({ retainRatio: 0.2, retainTokens: 500 })).toThrow(/set retainRatio or retainTokens, not both/)
  })

  it('rejects invalid chunkTokens and stubTokens', () => {
    expect(() => resolveConfig({ chunkTokens: 50 })).toThrow(/chunkTokens must be an integer >= 100/)
    expect(() => resolveConfig({ stubTokens: 10 })).toThrow(/stubTokens must be an integer >= 20/)
  })

  it('rejects unmatched summarizationProvider / summarizationModel', () => {
    expect(() => resolveConfig({ summarizationProvider: 'foo' })).toThrow(/must be set together/)
    expect(() => resolveConfig({ summarizationModel: 'bar' })).toThrow(/must be set together/)
  })

  it('rejects invalid maxTokens or retries', () => {
    expect(() => resolveConfig({ maxTokens: 0 })).toThrow(/maxTokens must be a positive integer/)
    expect(() => resolveConfig({ compactionRetries: -1 })).toThrow(/compactionRetries must be a non-negative integer/)
    expect(() => resolveConfig({ maxOverflowRetries: -1 })).toThrow(/maxOverflowRetries must be a non-negative integer/)
    expect(() => resolveConfig({ auto: 'true' as never })).toThrow(/auto must be a boolean/)
    expect(() => resolveConfig({ retainTokens: -10 })).toThrow(/retainTokens must be a non-negative integer/)
  })

  it('validates and merges modelPolicies', () => {
    const config = resolveConfig({
      modelPolicies: [{
        provider: 'custom',
        model: 'model-x',
        thresholdRatio: 0.7,
        chunkTokens: 3000,
        summarizationProvider: 'p',
        summarizationModel: 'm',
      }],
    })
    expect(config.modelPolicies).toHaveLength(1)
    const policy = resolveTargetPolicy(config, { provider: 'custom', model: 'model-x' })
    expect(policy.thresholdRatio).toBe(0.7)
    expect(policy.chunkTokens).toBe(3000)

    const fallbackPolicy = resolveTargetPolicy(config, { provider: 'other', model: 'other' })
    expect(fallbackPolicy.thresholdRatio).toBe(0.8)
    expect(fallbackPolicy.chunkTokens).toBe(4000)
  })

  it('rejects duplicate model policies', () => {
    expect(() => resolveConfig({
      modelPolicies: [
        { provider: 'p', model: 'm' },
        { provider: 'p', model: 'm' },
      ],
    })).toThrow(/duplicate model policy/)
  })

  it('constructs TargetPressureConfigError correctly', () => {
    const err = new TargetPressureConfigError('test-provider/test-model', 'No context capacity')
    expect(err.targetKey).toBe('test-provider/test-model')
    expect(err.message).toBe('No context capacity')
    expect(err).toBeInstanceOf(Error)
  })

  it('resolves retainTokens override and applies in target policy and compact spec', () => {
    const config = resolveConfig({
      thresholdRatio: 0.7,
      retainTokens: 500,
      modelPolicies: [
        {
          provider: 'custom',
          model: 'm1',
          retainTokens: 250,
        },
        {
          provider: 'custom',
          model: 'm2',
          retainRatio: 0.1,
        },
      ],
    })
    expect(config.retainTokens).toBe(500)
    expect(config.retainRatio).toBeUndefined()

    const p1 = resolveTargetPolicy(config, { provider: 'custom', model: 'm1' })
    expect(p1.retainTokens).toBe(250)
    expect(p1.retainRatio).toBeUndefined()

    const spec1 = resolveCompactSpec(p1, 10_000)
    expect(spec1.retainTokens).toBe(250)

    const p2 = resolveTargetPolicy(config, { provider: 'custom', model: 'm2' })
    expect(p2.retainRatio).toBe(0.1)
    expect(p2.retainTokens).toBeUndefined()

    const spec2 = resolveCompactSpec(p2, 10_000)
    expect(spec2.retainTokens).toBe(1000)

    const pFallback = resolveTargetPolicy(config, { provider: 'fallback', model: 'f' })
    expect(pFallback.retainTokens).toBe(500)
  })

  it('rejects invalid model policy structure', () => {
    expect(() => resolveConfig({
      modelPolicies: [{
        provider: 'p',
        model: 'm',
        unknownKey: 'invalid',
      } as never],
    })).toThrow(/unknown key "unknownKey"/)

    expect(() => resolveConfig({
      modelPolicies: [{
        provider: 'p',
        model: 'm',
        thresholdRatio: 0.5,
        retainRatio: 0.6,
      }],
    })).toThrow(/retainRatio .* must sit strictly below thresholdRatio/)
  })

  it('resolves compact spec from target policy and contextWindow', () => {
    const policy = resolveTargetPolicy(resolveConfig(), { provider: 'p', model: 'm' })
    const spec = resolveCompactSpec(policy, 10_000)
    expect(spec.thresholdTokens).toBe(8000)
    expect(spec.retainTokens).toBe(1600)
    expect(spec.chunkTokens).toBe(4000)
    expect(spec.stubTokens).toBe(200)

    const specDefault = resolveCompactSpec({ thresholdRatio: 0.5 } as never, 10_000)
    expect(specDefault.retainTokens).toBe(1600)
  })
})

describe('Chunking and Partitioning', () => {
  it('detects recall tool events accurately', () => {
    expect(isRecallToolEvent({
      type: 'tool/call',
      seq: SessionSeq(1),
      data: { callId: '1' as never, name: 'history_read', input: {} },
    } as never)).toBe(true)

    expect(isRecallToolEvent({
      type: 'tool/call',
      seq: SessionSeq(1),
      data: { callId: '1' as never, name: 'history_search', input: {} },
    } as never)).toBe(true)

    expect(isRecallToolEvent({
      type: 'tool/result',
      seq: SessionSeq(2),
      data: { callId: '1' as never, name: 'history_search', result: {} },
    } as never)).toBe(true)

    expect(isRecallToolEvent({
      type: 'turn/start',
      seq: SessionSeq(4),
      data: { turn: 1 },
    } as never)).toBe(false)

    expect(isRecalledOnlySpan(Session.create(SessionId('empty-span')), [SessionSeq(999)])).toBe(false)
  })

  it('handles partition plan edge cases (empty nodes, no system message, unbalance, missing measurement)', () => {
    const emptySession = Session.create(SessionId('empty-sess'))
    expect(selectPartitionPlan(emptySession, { totalTokens: 0, nodes: [] } as never, 1000, 100)).toBeNull()

    const onlySysSess = Session.create(SessionId('only-sys'))
    appendSystem(onlySysSess, 'System only')
    expect(selectPartitionPlan(onlySysSess, {
      totalTokens: 10,
      nodes: onlySysSess.surface.nodes.map(() => ({ tokens: 10 })),
    } as never, 100, 0)).toBeNull()

    const noSysSess = Session.create(SessionId('no-sys'))
    appendUser(noSysSess, 'User 1')
    appendAssistant(noSysSess, 'Assistant 1')
    appendUser(noSysSess, 'User 2')
    appendAssistant(noSysSess, 'Assistant 2')
    const planNoSys = selectPartitionPlan(noSysSess, {
      totalTokens: 100,
      nodes: noSysSess.surface.nodes.map(() => ({ tokens: 25 })),
    } as never, 1000, 25)
    expect(planNoSys).not.toBeNull()
    expect(planNoSys!.compactableStartSeq).toBe(noSysSess.surface.nodes[0])

    // Fallback when measurement.nodes has no entries
    const planNoMeas = selectPartitionPlan(noSysSess, {
      totalTokens: 100,
      nodes: [],
    } as never, 50, 0)
    expect(planNoMeas).not.toBeNull()

    const unbalSess = Session.create(SessionId('unbalanced'))
    appendSystem(unbalSess, 'System')
    unbalSess.append('turn/start', { turn: 1 })
    unbalSess.append('step/start', { turn: 1, step: 1 })
    unbalSess.append('assistant/message', {
      stream: [],
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'c1' as never, name: 'bash', arguments: '{}' }],
        source: { kind: 'model', provider: MODEL, model: MODEL },
      }),
    }, { surfaceOp: 'append' })
    appendUser(unbalSess, 'trailing')
    expect(selectPartitionPlan(unbalSess, {
      totalTokens: 75,
      nodes: unbalSess.surface.nodes.map(() => ({ tokens: 25 })),
    } as never, 100, 0)).toBeNull()
  })

  it('steps backward in chunking when boundary lands inside open tool call', () => {
    const toolSess = Session.create(SessionId('tool-chunking'))
    appendSystem(toolSess, 'System')
    appendUser(toolSess, 'User 1')
    // Turn 1 tool call
    toolSess.append('turn/start', { turn: 1 })
    toolSess.append('step/start', { turn: 1, step: 1 })
    toolSess.append('assistant/message', {
      stream: [],
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'tc1' as never, name: 'bash', arguments: '{}' }],
        source: { kind: 'model', provider: MODEL, model: MODEL },
      }),
    }, { surfaceOp: 'append' })
    toolSess.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: 'tc1' as never,
        content: [{ type: 'text', text: 'Result 1' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    appendUser(toolSess, 'User 2')
    appendAssistant(toolSess, 'Assistant 2')
    appendUser(toolSess, 'User 3')
    appendAssistant(toolSess, 'Assistant 3')

    const toolMeas = {
      totalTokens: 1000,
      nodes: toolSess.surface.nodes.map((_, idx) => ({ tokens: idx === 2 ? 300 : 50 })),
    }
    const toolPlan = selectPartitionPlan(toolSess, toolMeas as never, 200, 50)
    expect(toolPlan).not.toBeNull()
    expect(toolPlan!.chunks.length).toBeGreaterThan(0)
  })

  it('partitions small conversation into single trailing slice without chunks', () => {
    const session = Session.create(SessionId('test-small'))
    appendSystem(session, 'System prompt')
    appendUser(session, 'User message 1')
    appendAssistant(session, 'Assistant message 1')
    appendUser(session, 'User message 2')

    const measurement = {
      totalTokens: 100,
      nodes: session.surface.nodes.map(() => ({ tokens: 25 })),
    }

    const plan = selectPartitionPlan(session, measurement as never, 1000, 25)
    expect(plan).not.toBeNull()
    expect(plan!.chunks).toHaveLength(0)
    expect(plan!.trailingSlice.shadowedSeqs).toHaveLength(2)
  })

  it('partitions large conversation into index chunks and trailing slice', () => {
    const session = Session.create(SessionId('test-large'))
    appendSystem(session, 'System')
    for (let i = 1; i <= 10; i++) {
      appendUser(session, `User ${i}`.repeat(50))
      appendAssistant(session, `Assistant ${i}`.repeat(50))
    }

    const measurement = {
      totalTokens: 4000,
      nodes: session.surface.nodes.map(() => ({ tokens: 200 })),
    }

    const plan = selectPartitionPlan(session, measurement as never, 800, 400)
    expect(plan).not.toBeNull()
    expect(plan!.chunks.length).toBeGreaterThan(0)
    expect(plan!.trailingSlice).toBeDefined()
  })

  it('handles sparse measurement nodes in chunking', () => {
    const session = Session.create(SessionId('sparse-test'))
    appendSystem(session, 'System')
    appendUser(session, 'U1')
    appendAssistant(session, 'A1')
    appendUser(session, 'U2')
    appendAssistant(session, 'A2')
    appendUser(session, 'U3')
    appendAssistant(session, 'A3')
    const sparseMeas = {
      totalTokens: 1000,
      nodes: [
        { tokens: 10 },
        undefined as never,
        { tokens: 200 },
        undefined as never,
        { tokens: 200 },
        undefined as never,
        { tokens: 50 },
      ],
    }
    const plan = selectPartitionPlan(session, sparseMeas as never, 100, 30)
    expect(plan).not.toBeNull()
    expect(plan!.chunks.length).toBeGreaterThan(0)
  })

  it('findLastCommittedIndexCheckpoint identifies index stubs vs state', () => {
    const session = Session.create(SessionId('test-chk'))
    expect(findLastCommittedIndexCheckpoint(session)).toBe(-1)

    appendSystem(session, 'System')
    expect(findLastCommittedIndexCheckpoint(session)).toBe(-1)

    // When eventAt returns undefined
    vi.spyOn(session, 'eventAt').mockReturnValueOnce(undefined)
    expect(findLastCommittedIndexCheckpoint(session)).toBe(-1)

    // State checkpoint at surface node 1
    const stateSess = Session.create(SessionId('find-state'))
    appendSystem(stateSess, 'System')
    const cStateId = CompactionId('state-1')
    stateSess.append('compaction/start', { compactionId: cStateId, turn: 1 })
    stateSess.append('compaction/summary', {
      compactionId: cStateId,
      summary: [{ type: 'text', text: 'State' }],
      shadowedRange: { start: SessionSeq(1), end: SessionSeq(2) },
      shadowedSeqs: [SessionSeq(1)],
      shadowedTokenCount: 10,
      provider: 'p',
      model: 'm',
      checkpointKind: 'state',
    })
    stateSess.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'State text' }],
      source: compactCheckpointSource(cStateId),
    }), { surfaceOp: 'append' })
    expect(findLastCommittedIndexCheckpoint(stateSess)).toBe(-1)

    // Index checkpoint at surface node 1
    const idxSess = Session.create(SessionId('find-idx'))
    appendSystem(idxSess, 'System')
    const cIdxId = CompactionId('idx-1')
    idxSess.append('compaction/start', { compactionId: cIdxId, turn: 1 })
    idxSess.append('compaction/summary', {
      compactionId: cIdxId,
      summary: [{ type: 'text', text: 'Index' }],
      shadowedRange: { start: SessionSeq(1), end: SessionSeq(2) },
      shadowedSeqs: [SessionSeq(1)],
      shadowedTokenCount: 10,
      provider: 'p',
      model: 'm',
      checkpointKind: 'index',
    })
    idxSess.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Index text' }],
      source: compactCheckpointSource(cIdxId),
    }), { surfaceOp: 'append' })
    expect(findLastCommittedIndexCheckpoint(idxSess)).toBe(1)
  })
})

describe('Summarization & Degradation', () => {
  it('summarizes recalled-only chunk without invoking LLM', async () => {
    const ctx = createContext()
    const config = { summarizationProvider: 'default', summarizationModel: 'default', maxTokens: 1000 }
    const session = Session.create(SessionId('recalled-chunk'))
    const agent = createAgent(session)

    const chunk = {
      startSeq: SessionSeq(1),
      endSeq: SessionSeq(2),
      startIdx: 0,
      endIdx: 1,
      shadowedSeqs: [SessionSeq(1), SessionSeq(2)],
      estimatedTokens: 100,
      isRecalledOnly: true,
    }

    const result = await summarizeChunk(ctx, config, chunk, agent, [])
    expect(result.provider).toBe('code')
    expect(result.summary[0]!.type).toBe('text')
    expect((result.summary[0] as { text: string }).text).toContain('Recalled conversation history')
    expect(result.keywords).toContain('history_read')
  })

  it('degrades to code-composed fallback stub when chunk LLM fails', async () => {
    const ctx = createContext(10_000, '', true) // will fail LLM stream
    const config = { summarizationProvider: 'default', summarizationModel: 'default', maxTokens: 1000 }
    const session = Session.create(SessionId('failed-chunk'))
    const agent = createAgent(session)

    const chunk = {
      startSeq: SessionSeq(3),
      endSeq: SessionSeq(5),
      startIdx: 0,
      endIdx: 2,
      shadowedSeqs: [SessionSeq(3), SessionSeq(4), SessionSeq(5)],
      estimatedTokens: 300,
      isRecalledOnly: false,
    }

    const result = await summarizeChunk(ctx, config, chunk, agent, [
      createUserMessage({ content: [{ type: 'text', text: 'Hello' }], source: { kind: 'user' } }),
    ])
    expect(result.provider).toBe('code-fallback')
    expect((result.summary[0] as { text: string }).text).toContain('code-composed fallback stub')
    expect(result.keywords).toContain('chunk-fallback')
  })

  it('summarizeState succeeds with valid output and fails on stream error', async () => {
    const ctx = createContext(10_000, '## Working Memory State\nKey decisions: keep it simple')
    const config = { summarizationProvider: 'default', summarizationModel: 'default', maxTokens: 1000 }
    const session = Session.create(SessionId('state-summary'))
    const agent = createAgent(session)

    const result = await summarizeState(ctx, config, agent, [
      createUserMessage({ content: [{ type: 'text', text: 'Fix the bug in server' }], source: { kind: 'user' } }),
    ])
    expect(result.provider).toBe('default')
    expect((result.summary[0] as { text: string }).text).toContain('Working Memory State')

    // Error case
    const failingCtx = createContext(10_000, '', true)
    await expect(summarizeState(failingCtx, config, agent, [])).rejects.toThrow(/simulated LLM stream error/)
  })

  it('handles summarizer edge cases (missing targets, priors, empty outputs, fallback errors)', async () => {
    const config = { summarizationProvider: 'default', summarizationModel: 'default', maxTokens: 1000 }
    const emptyAgent = {
      session: Session.create(SessionId('no-target')),
      options: {},
    } as unknown as Agent
    await expect(summarizeState(createContext(), { summarizationProvider: '', summarizationModel: '', maxTokens: 100 }, emptyAgent, []))
      .rejects.toThrow(/no provider\/model available for summarization/)

    const optAgent = {
      session: Session.create(SessionId('opt-agent')),
      options: { provider: 'default', model: 'default' },
    } as unknown as Agent
    const resOpt = await summarizeState(createContext(), { summarizationProvider: '', summarizationModel: '', maxTokens: 100 }, optAgent, [])
    expect(resOpt.provider).toBe('default')

    const emptyStateCtx = createContext(10_000, '   ')
    await expect(summarizeState(emptyStateCtx, config, optAgent, [])).rejects.toThrow(/produced no text content/)

    const chunk = {
      startSeq: SessionSeq(1),
      endSeq: SessionSeq(2),
      startIdx: 0,
      endIdx: 1,
      shadowedSeqs: [SessionSeq(1), SessionSeq(2)],
      estimatedTokens: 100,
      isRecalledOnly: false,
    }

    const ctx = createContext()
    const resPriors = await summarizeChunk(ctx, config, chunk, optAgent, [], 'prior state text', ['kw1', 'kw2'])
    expect(resPriors.keywords).toBeDefined()

    const emptyChunkCtx = createContext(10_000, '   \n  ')
    const resEmpty = await summarizeChunk(emptyChunkCtx, config, chunk, optAgent, [])
    expect(resEmpty.provider).toBe('code-fallback')

    const noKwCtx = createContext(10_000, 'Plain text summary without keywords line')
    const resNoKw = await summarizeChunk(noKwCtx, config, chunk, optAgent, [])
    expect(resNoKw.keywords).toEqual([])

    const strErrCtx = createContext()
    vi.spyOn(strErrCtx.llm, 'stream').mockImplementationOnce(async function* () {
      throw 'string error message'
    })
    const resStrErr = await summarizeChunk(strErrCtx, config, chunk, optAgent, [])
    expect(resStrErr.provider).toBe('code-fallback')
  })
})
function conversation(turns = 4, text = 'fixture '.repeat(40).trim(), system?: string): Session {
  const session = Session.create(SessionId(`conversation-${turns}`))
  for (let turn = 1; turn <= turns; turn += 1) {
    session.append('turn/start', { turn })
    if (turn === 1 && system !== undefined) {
      session.append('system/message', {
        turn,
        step: 1,
        message: createSystemMessage(system, 'system-prompt'),
      }, { surfaceOp: 'append' })
    }
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `${text} user ${turn}` }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('step/start', { turn, step: 1 })
    if (turn === 1) {
      session.append('request/header', {
        header: { config: { provider: MODEL, model: MODEL } },
        reason: 'initial',
      })
    }
    session.append('assistant/message', {
      stream: [],
      turn,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: `${text} assistant ${turn}` }],
        source: { kind: 'model', provider: MODEL, model: MODEL },
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn, step: 1 })
    session.append('turn/end', { turn, reason: { kind: 'completed' } })
  }
  return session
}

describe('RecallableCompactionEngine execution', () => {
  it('runs multi-chunk compaction and produces [stubs...][state][tail] with deterministic footers', async () => {
    const ctx = createContext(2000, 'Chunk summary lines.\nKeywords: api; config; error')
    const session = conversation(8, 'Task detail text '.repeat(40), 'System prompt')

    const engine = new RecallableCompactionEngine(ctx, {
      thresholdRatio: 0.5,
      retainRatio: 0.1,
      chunkTokens: 150,
      stubTokens: 40,
      compactionRetries: 0,
      summarizationProvider: 'default',
      summarizationModel: 'default',
    })

    const agent = createAgent(session)
    const result = await engine.compactIfNeeded(agent, 'pressure', SIGNAL)

    expect(result).not.toBeNull()
    expect(result!.checkpointKind).toBe('state')
    expect(result!.shadowedRange).toBeDefined()

    // Inspect session surface nodes
    const nodes = session.surface.nodes
    const headEvent = session.eventAt(nodes[0]!)
    expect(headEvent?.type).toBe('system/message')

    // Check that we have index stubs followed by the state checkpoint
    const summaries = session.snapshotEvents().filter(e => e.type === 'compaction/summary')
    expect(summaries.length).toBeGreaterThan(1)

    const indexSummaries = summaries.filter(s => s.data.checkpointKind === 'index')
    const stateSummaries = summaries.filter(s => s.data.checkpointKind === 'state')
    expect(indexSummaries.length).toBeGreaterThan(0)
    expect(stateSummaries).toHaveLength(1)

    // Check footers match CHECKPOINT_FOOTER_RE
    const messages = session.deriveMessages()
    for (const msg of messages) {
      if (msg.source?.kind === 'plugin' && msg.source.plugin === 'compact') {
        const text = (msg.content[0] as { text: string }).text
        expect(text).toMatch(CHECKPOINT_FOOTER_RE)
      }
    }
  })

  it('second pass folds superseded state checkpoint into new chunk and keeps earlier stubs untouched', async () => {
    const ctx = createContext(1000, 'Pass summary.\nKeywords: alpha; beta')
    const session = conversation(6, 'Long user request '.repeat(30), 'System')

    const engine = new RecallableCompactionEngine(ctx, {
      thresholdRatio: 0.4,
      retainRatio: 0.15,
      chunkTokens: 200,
      stubTokens: 40,
      summarizationProvider: 'default',
      summarizationModel: 'default',
    })

    const agent = createAgent(session)
    const pass1Result = await engine.compactIfNeeded(agent, 'pressure', SIGNAL)
    expect(pass1Result).not.toBeNull()

    const pass1Nodes = [...session.surface.nodes]
    const pass1FirstStubSeq = pass1Nodes[1]!

    // Append new turns to trigger pass 2
    for (let turn = 7; turn <= 12; turn++) {
      session.append('turn/start', { turn })
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: `Turn ${turn} request `.repeat(30) }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      session.append('step/start', { turn, step: 1 })
      session.append('assistant/message', {
        stream: [],
        turn,
        step: 1,
        message: createMessage({
          role: 'assistant',
          content: [{ type: 'text', text: `Turn ${turn} response `.repeat(30) }],
          source: { kind: 'model', provider: MODEL, model: MODEL },
        }),
      }, { surfaceOp: 'append' })
      session.append('step/end', { turn, step: 1 })
      session.append('turn/end', { turn, reason: { kind: 'completed' } })
    }

    // Pass 2 generates summary without keywords
    vi.spyOn(ctx.llm, 'stream').mockImplementation(async function* () {
      yield { type: 'text-delta', index: 0, text: 'Pass 2 summary without keywords marker' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })

    const pass2Result = await engine.compactIfNeeded(agent, 'pressure', SIGNAL)
    expect(pass2Result).not.toBeNull()

    const pass2Nodes = session.surface.nodes
    // Verify first stub from pass 1 remains byte-identical and at node 1!
    expect(pass2Nodes[1]!).toBe(pass1FirstStubSeq)

    // Pass 3: append turns 13-18 to read both pass 1 stub (with keywords) and pass 2 stub (without keywords)
    for (let turn = 13; turn <= 18; turn++) {
      session.append('turn/start', { turn })
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: `Turn ${turn} request `.repeat(30) }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      session.append('step/start', { turn, step: 1 })
      session.append('assistant/message', {
        stream: [],
        turn,
        step: 1,
        message: createMessage({
          role: 'assistant',
          content: [{ type: 'text', text: `Turn ${turn} response `.repeat(30) }],
          source: { kind: 'model', provider: MODEL, model: MODEL },
        }),
      }, { surfaceOp: 'append' })
      session.append('step/end', { turn, step: 1 })
      session.append('turn/end', { turn, reason: { kind: 'completed' } })
    }
    const pass3Result = await engine.compactIfNeeded(agent, 'pressure', SIGNAL)
    expect(pass3Result).not.toBeNull()
  })

  it('inflation guard aborts pass if post-compaction size is not strictly below pre-compaction', async () => {
    // Generate giant summary that inflates beyond input
    const giantSummary = 'x'.repeat(10_000)
    const ctx = createContext(10_000, giantSummary)
    const session = conversation(2, 'Short', 'System')

    const engine = new RecallableCompactionEngine(ctx, {
      thresholdRatio: 0.01,
      retainRatio: 0.005,
      chunkTokens: 500,
      stubTokens: 50,
      summarizationProvider: 'default',
      summarizationModel: 'default',
    })

    const agent = createAgent(session)
    const result = await engine.compactIfNeeded(agent, 'pressure', SIGNAL)
    expect(result).toBeNull()
  })

  it('compactNow forces maintenance compaction on demand', async () => {
    const ctx = createContext(10_000, 'Manual compaction summary\nKeywords: manual; compact')
    const session = conversation(3, 'Task detail text', 'System')

    const engine = new RecallableCompactionEngine(ctx, {
      summarizationProvider: 'default',
      summarizationModel: 'default',
    })

    const agent = createAgent(session)
    const result = await engine.compactNow(agent, SIGNAL)
    expect(result).not.toBeNull()
    expect(result!.checkpointKind).toBe('state')
  })

  it('compactRegion compacts a specified surface range', async () => {
    const ctx = createContext(10_000, 'Region summary\nKeywords: region; test')
    const session = conversation(4, 'Span item content '.repeat(10), 'System')

    const engine = new RecallableCompactionEngine(ctx, {
      summarizationProvider: 'default',
      summarizationModel: 'default',
    })

    const agent = createAgent(session)
    const nodes = session.surface.nodes
    const result = await engine.compactRegion(nodes[1]!, nodes[3]!, agent, SIGNAL)
    expect(result).not.toBeNull()

    // Invalid range throws error
    await expect(engine.compactRegion(SessionSeq(999), SessionSeq(1000), agent, SIGNAL)).rejects.toThrow(/invalid surface range/)
  })

  it('context-overflow trigger forces compaction with zero retention', async () => {
    const ctx = createContext(10_000, 'Overflow summary\nKeywords: overflow; recovery')
    const session = conversation(4, 'Overflow message content '.repeat(20), 'System')

    const engine = new RecallableCompactionEngine(ctx, {
      summarizationProvider: 'default',
      summarizationModel: 'default',
    })

    const agent = createAgent(session)
    const result = await engine.compactIfNeeded(agent, 'context-overflow', SIGNAL)
    expect(result).not.toBeNull()
  })

  it('handles agent/pre-step waterfall and TargetPressureConfigError warning suppression', async () => {
    const ctx = createContext(1000, 'Pre-step summary\nKeywords: pre-step')
    new RecallableCompactionEngine(ctx, {
      thresholdRatio: 0.5,
      retainRatio: 0.1,
      auto: true,
      summarizationProvider: 'default',
      summarizationModel: 'default',
    })
    const session = conversation(8, 'Task detail text '.repeat(40), 'System prompt')
    const agent = createAgent(session)

    // Pre-step runs compaction
    await ctx.waterfall('agent/pre-step', {
      agent,
      messages: [],
      turn: 1,
      step: 1,
      signal: SIGNAL,
    }, () => Promise.resolve({ kind: 'enter', messages: [] }))

    // Pre-step ignores aborted signal
    const abortedSignal = AbortSignal.abort('test abort')
    await ctx.waterfall('agent/pre-step', {
      agent,
      messages: [],
      turn: 1,
      step: 1,
      signal: abortedSignal,
    }, () => Promise.resolve({ kind: 'enter', messages: [] }))

    // Pre-step warning suppression for TargetPressureConfigError
    const noCapCtx = createContext()
    vi.spyOn(noCapCtx.llm, 'resolveModelInfo').mockResolvedValueOnce({
      provider: MODEL,
      id: MODEL,
      name: MODEL,
    })
    new RecallableCompactionEngine(noCapCtx, { auto: true })
    const sess2 = conversation(4, 'Text '.repeat(20), 'System')
    const ag2 = createAgent(sess2)
    const warnSpy = vi.fn()
    noCapCtx.logger.warn = warnSpy as never

    await noCapCtx.waterfall('agent/pre-step', {
      agent: ag2,
      messages: [],
      turn: 1,
      step: 1,
      signal: SIGNAL,
    }, () => Promise.resolve({ kind: 'enter', messages: [] }))
    expect(warnSpy).toHaveBeenCalledTimes(1)

    // Second call suppresses warning
    vi.spyOn(noCapCtx.llm, 'resolveModelInfo').mockResolvedValueOnce({
      provider: MODEL,
      id: MODEL,
      name: MODEL,
    })
    await noCapCtx.waterfall('agent/pre-step', {
      agent: ag2,
      messages: [],
      turn: 1,
      step: 1,
      signal: SIGNAL,
    }, () => Promise.resolve({ kind: 'enter', messages: [] }))
    expect(warnSpy).toHaveBeenCalledTimes(1)

    // General error in pre-step logs warning and continues
    const errCtx = createContext()
    const engErr = new RecallableCompactionEngine(errCtx, { auto: true })
    vi.spyOn(engErr, 'compactIfNeeded').mockRejectedValueOnce(new Error('general error'))
    const errWarnSpy = vi.fn()
    errCtx.logger.warn = errWarnSpy as never
    await errCtx.waterfall('agent/pre-step', {
      agent: ag2,
      messages: [],
      turn: 1,
      step: 1,
      signal: SIGNAL,
    }, () => Promise.resolve({ kind: 'enter', messages: [] }))
    expect(errWarnSpy).toHaveBeenCalled()

    // Non-Error rejection in pre-step
    vi.spyOn(engErr, 'compactIfNeeded').mockRejectedValueOnce('string error from pre-step')
    await errCtx.waterfall('agent/pre-step', {
      agent: ag2,
      messages: [],
      turn: 1,
      step: 1,
      signal: SIGNAL,
    }, () => Promise.resolve({ kind: 'enter', messages: [] }))

    // Pre-step when compactIfNeeded returns null (below threshold)
    const belowThreshCtx = createContext(100_000)
    new RecallableCompactionEngine(belowThreshCtx, { auto: true, thresholdRatio: 0.8 })
    const belowSess = conversation(1, 'Short text', 'System')
    const belowAgent = createAgent(belowSess)
    await belowThreshCtx.waterfall('agent/pre-step', {
      agent: belowAgent,
      messages: [],
      turn: 1,
      step: 1,
      signal: SIGNAL,
    }, () => Promise.resolve({ kind: 'enter', messages: [] }))
  })

  it('handles agent/request-error, context overflow recovery, and retry cleanup', async () => {
    const ctx = createContext(10_000, 'Recovery summary\nKeywords: recovered')
    new RecallableCompactionEngine(ctx, {
      auto: true,
      maxOverflowRetries: 1,
      summarizationProvider: 'default',
      summarizationModel: 'default',
    })
    const session = conversation(4, 'Overflow message content '.repeat(20), 'System')
    const agent = createAgent(session)

    // Successful overflow recovery
    const retryResult = await ctx.waterfall('agent/request-error', {
      agent,
      turn: 1,
      step: 1,
      provider: MODEL,
      failure: { message: 'Window exceeded', code: CONTEXT_WINDOW_EXCEEDED_CODE },
      retryPolicy: undefined,
      signal: SIGNAL,
    }, () => Promise.resolve(undefined))
    expect(retryResult).toEqual({ kind: 'retry' })

    // Max retries exceeded
    const exceededResult = await ctx.waterfall('agent/request-error', {
      agent,
      turn: 1,
      step: 1,
      provider: MODEL,
      failure: { message: 'Window exceeded', code: CONTEXT_WINDOW_EXCEEDED_CODE },
      retryPolicy: undefined,
      signal: SIGNAL,
    }, () => Promise.resolve(undefined))
    expect(exceededResult).toBeUndefined()

    // Non-overflow error and aborted signal are passed through
    const otherResult = await ctx.waterfall('agent/request-error', {
      agent,
      turn: 1,
      step: 1,
      provider: MODEL,
      failure: { message: 'Network', code: 'NETWORK_ERROR' },
      retryPolicy: undefined,
      signal: SIGNAL,
    }, () => Promise.resolve(undefined))
    expect(otherResult).toBeUndefined()

    const abortedResult = await ctx.waterfall('agent/request-error', {
      agent,
      turn: 1,
      step: 1,
      provider: MODEL,
      failure: { message: 'Window exceeded', code: CONTEXT_WINDOW_EXCEEDED_CODE },
      retryPolicy: undefined,
      signal: AbortSignal.abort(),
    }, () => Promise.resolve(undefined))
    expect(abortedResult).toBeUndefined()

    // Status 'idle' and 'running'
    ctx.emit('agent/status', { agent, status: 'idle' })
    ctx.emit('agent/status', { agent, status: 'running' })

    // session/event handlers with real committed events
    const ev1 = session.append('turn/start', { turn: 10 })
    ctx.emit('session/event', session, ev1)

    const otherSess = Session.create(SessionId('other-session-event'))
    const otherEv = otherSess.append('turn/start', { turn: 1 })
    ctx.emit('session/event', otherSess, otherEv)

    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'u' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 10, step: 1 })
    const ev2 = session.append('assistant/message', {
      stream: [],
      turn: 10,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'cleared' }],
        source: { kind: 'model', provider: MODEL, model: MODEL },
      }),
    }, { surfaceOp: 'append' })
    ctx.emit('session/event', session, ev2)

    // Unrecorded session event for line 161 path 2
    const unrecSess = Session.create(SessionId('unrecorded-sess'))
    const unrecEv = unrecSess.append('assistant/message', {
      stream: [],
      turn: 1,
      step: 1,
      message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'unrecorded' }], source: { kind: 'model', provider: MODEL, model: MODEL } }),
    }, { surfaceOp: 'append' })
    ctx.emit('session/event', unrecSess, unrecEv)

    // Request error with no target on session
    const noTgtSession = Session.create(SessionId('no-tgt-session'))
    const noTgtAgentReq = { session: noTgtSession, options: {} } as unknown as Agent
    const noTgtReqRes = await ctx.waterfall('agent/request-error', {
      agent: noTgtAgentReq,
      turn: 1,
      step: 1,
      provider: MODEL,
      failure: { message: 'Window exceeded', code: CONTEXT_WINDOW_EXCEEDED_CODE },
      retryPolicy: undefined,
      signal: SIGNAL,
    }, () => Promise.resolve(undefined))
    expect(noTgtReqRes).toBeUndefined()

    // Request error recovery failure after surface progress
    const progressCtx = createContext(10_000, 'Recovery summary\nKeywords: recovered')
    const progressEngine = new RecallableCompactionEngine(progressCtx, {
      auto: true,
      maxOverflowRetries: 5,
      summarizationProvider: 'default',
      summarizationModel: 'default',
    })
    const progressSession = conversation(4, 'Overflow message content '.repeat(20), 'System')
    const progressAgent = createAgent(progressSession)
    vi.spyOn(progressEngine, 'compactIfNeeded').mockImplementationOnce(async (ag) => {
      ag.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'progress' }], source: { kind: 'user' } }), {
        surfaceOp: { op: 'replace', startSeq: ag.session.surface.nodes[1]!, endSeq: ag.session.surface.nodes[2]! },
        sourceEventSeqs: [ag.session.surface.nodes[1]!, ag.session.surface.nodes[2]!],
      })
      throw new Error('fail after surface progress')
    })
    const progressRes = await progressCtx.waterfall('agent/request-error', {
      agent: progressAgent,
      turn: 1,
      step: 1,
      provider: MODEL,
      failure: { message: 'Window exceeded', code: CONTEXT_WINDOW_EXCEEDED_CODE },
      retryPolicy: undefined,
      signal: SIGNAL,
    }, () => Promise.resolve(undefined))
    expect(progressRes).toEqual({ kind: 'retry' })

    // Request error recovery failure without surface progress
    vi.spyOn(progressEngine, 'compactIfNeeded').mockRejectedValueOnce(new Error('fail without progress'))
    const noProgressRes = await progressCtx.waterfall('agent/request-error', {
      agent: progressAgent,
      turn: 1,
      step: 1,
      provider: MODEL,
      failure: { message: 'Window exceeded', code: CONTEXT_WINDOW_EXCEEDED_CODE },
      retryPolicy: undefined,
      signal: SIGNAL,
    }, () => Promise.resolve(undefined))
    expect(noProgressRes).toBeUndefined()

    // Non-Error rejection in overflow recovery
    vi.spyOn(progressEngine, 'compactIfNeeded').mockRejectedValueOnce('string overflow error')
    const stringErrRes = await progressCtx.waterfall('agent/request-error', {
      agent: progressAgent,
      turn: 1,
      step: 1,
      provider: MODEL,
      failure: { message: 'Window exceeded', code: CONTEXT_WINDOW_EXCEEDED_CODE },
      retryPolicy: undefined,
      signal: SIGNAL,
    }, () => Promise.resolve(undefined))
    expect(stringErrRes).toBeUndefined()

    // Request error recovery returning null while replaceGeneration advances
    vi.spyOn(progressEngine, 'compactIfNeeded').mockImplementationOnce(async (ag) => {
      ag.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'null with progress' }], source: { kind: 'user' } }), {
        surfaceOp: { op: 'replace', startSeq: ag.session.surface.nodes[1]!, endSeq: ag.session.surface.nodes[2]! },
        sourceEventSeqs: [ag.session.surface.nodes[1]!, ag.session.surface.nodes[2]!],
      })
      return null
    })
    const nullWithProgressRes = await progressCtx.waterfall('agent/request-error', {
      agent: progressAgent,
      turn: 1,
      step: 1,
      provider: MODEL,
      failure: { message: 'Window exceeded', code: CONTEXT_WINDOW_EXCEEDED_CODE },
      retryPolicy: undefined,
      signal: SIGNAL,
    }, () => Promise.resolve(undefined))
    expect(nullWithProgressRes).toEqual({ kind: 'retry' })

    // Request error recovery returning null
    vi.spyOn(progressEngine, 'compactIfNeeded').mockResolvedValueOnce(null)
    const nullRecRes = await progressCtx.waterfall('agent/request-error', {
      agent: progressAgent,
      turn: 1,
      step: 1,
      provider: MODEL,
      failure: { message: 'Window exceeded', code: CONTEXT_WINDOW_EXCEEDED_CODE },
      retryPolicy: undefined,
      signal: SIGNAL,
    }, () => Promise.resolve(undefined))
    expect(nullRecRes).toBeUndefined()
  })

  it('compactNow supports sourceCommandId, null plan, non-user start, and empty assistant message', async () => {
    const ctx = createContext(10_000, 'Cmd summary\nKeywords: cmd', false, { inputTokens: 50, outputTokens: 20 })
    const engine = new RecallableCompactionEngine(ctx, {
      chunkTokens: 100,
      stubTokens: 30,
      summarizationProvider: 'default',
      summarizationModel: 'default',
    })
    // Build session with empty assistant message in turn 1 (inside chunk 0)
    const session = Session.create(SessionId('cmd-empty-msg'))
    appendSystem(session, 'System')
    appendUser(session, 'U1 '.repeat(60))
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('request/header', {
      header: { config: { provider: MODEL, model: MODEL } },
      reason: 'initial',
    })
    session.append('assistant/message', {
      turn: 1,
      step: 1,
      stream: [],
      message: createMessage({ role: 'assistant', content: [], source: { kind: 'model', provider: MODEL, model: MODEL } }),
    }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    for (let turn = 2; turn <= 6; turn++) {
      session.append('turn/start', { turn })
      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: `U${turn} `.repeat(60) }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      session.append('step/start', { turn, step: 1 })
      session.append('assistant/message', {
        turn,
        step: 1,
        stream: [],
        message: createMessage({
          role: 'assistant',
          content: [{ type: 'text', text: `A${turn} `.repeat(60) }],
          source: { kind: 'model', provider: MODEL, model: MODEL },
        }),
      }, { surfaceOp: 'append' })
      session.append('step/end', { turn, step: 1 })
      session.append('turn/end', { turn, reason: { kind: 'completed' } })
    }

    const agent = createAgent(session)
    const cmdId = CommandId('cmd-123')
    const result = await engine.compactNow(agent, SIGNAL, cmdId)
    expect(result).not.toBeNull()
    expect(result!.sourceCommandId).toBe(cmdId)

    // Non-user compactableStartSeq (covers line 276 firstEvent.type !== 'user/message')
    const noUserSess = Session.create(SessionId('no-sys-no-user'))
    noUserSess.append('request/header', {
      header: { config: { provider: MODEL, model: MODEL } },
      reason: 'initial',
    })
    noUserSess.append('turn/start', { turn: 1 })
    noUserSess.append('step/start', { turn: 1, step: 1 })
    noUserSess.append('assistant/message', {
      turn: 1,
      step: 1,
      stream: [],
      message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'Hello assistant '.repeat(20) }], source: { kind: 'model', provider: MODEL, model: MODEL } }),
    }, { surfaceOp: 'append' })
    noUserSess.append('step/end', { turn: 1, step: 1 })
    noUserSess.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    appendUser(noUserSess, 'User reply '.repeat(20), 2)
    appendAssistant(noUserSess, 'Assistant reply '.repeat(20), 2)
    const noUserAg = createAgent(noUserSess)
    const noUserRes = await engine.compactNow(noUserAg, SIGNAL)
    expect(noUserRes).not.toBeNull()

    // When plan is null
    const emptySession = Session.create(SessionId('empty-sess-now'))
    const emptyAgent = {
      session: emptySession,
      options: {},
      runMaintenance: <T>(task: (sig: AbortSignal) => Promise<T>) => task(SIGNAL),
    } as unknown as Agent
    expect(await engine.compactNow(emptyAgent, SIGNAL)).toBeNull()
  })

  it('covers compactIfNeeded retries and inflation guard abort', async () => {
    // 1. Line 237: if (plan === null) return result
    const ctx = createContext(1000, 'Retry summary\nKeywords: retry')
    const engine = new RecallableCompactionEngine(ctx, {
      thresholdRatio: 0.1,
      retainTokens: 500,
      compactionRetries: 2,
      chunkTokens: 100,
      stubTokens: 30,
      summarizationProvider: 'default',
      summarizationModel: 'default',
    })
    const session = conversation(6, 'Retry message text '.repeat(60), 'System')
    const agent = createAgent(session)

    let measureCalls = 0
    const realMeasure = ctx.tokenMeter.measure.bind(ctx.tokenMeter)
    vi.spyOn(ctx.tokenMeter, 'measure').mockImplementation((s) => {
      const real = realMeasure(s)
      measureCalls++
      if (measureCalls === 2) {
        return { ...real, totalTokens: 900 }
      }
      return real
    })

    const res = await engine.compactIfNeeded(agent, 'pressure', SIGNAL)
    expect(res).not.toBeNull()

    // 2. Line 239: if (result === null) return null
    const inflateCtx = createContext(1000, 'X '.repeat(5000))
    const inflateEngine = new RecallableCompactionEngine(inflateCtx, {
      thresholdRatio: 0.1,
      retainRatio: 0.05,
      summarizationProvider: 'default',
      summarizationModel: 'default',
    })
    const inflateSession = conversation(6, 'Text '.repeat(50), 'System')
    const inflateAgent = createAgent(inflateSession)
    const inflateRes = await inflateEngine.compactIfNeeded(inflateAgent, 'pressure', SIGNAL)
    expect(inflateRes).toBeNull()
  })

  it('compactIfNeeded covers toolResultPruner and missing target/capacity', async () => {
    const ctx = createContext(1000, 'Prune summary\nKeywords: pruner')
    const pruneSession = vi.fn()
    ctx.provide('toolResultPruner', { pruneSession })
    const engine = new RecallableCompactionEngine(ctx, {
      thresholdRatio: 0.5,
      retainRatio: 0.1,
      summarizationProvider: 'default',
      summarizationModel: 'default',
    })
    const session = conversation(8, 'Detail text '.repeat(40), 'System')
    const agent = createAgent(session)
    const result = await engine.compactIfNeeded(agent, 'pressure', SIGNAL)
    expect(result).not.toBeNull()
    expect(pruneSession).toHaveBeenCalled()

    // Missing target returns null
    const noTargetAgent = {
      session: Session.create(SessionId('no-tgt')),
      options: {},
    } as unknown as Agent
    expect(await engine.compactIfNeeded(noTargetAgent, 'pressure', SIGNAL)).toBeNull()

    // Empty options provider or model returns null
    const emptyOptAgent1 = { session: Session.create(SessionId('e1')), options: { provider: '', model: 'm' } } as unknown as Agent
    const emptyOptAgent2 = { session: Session.create(SessionId('e2')), options: { provider: 'p', model: '' } } as unknown as Agent
    expect(await engine.compactIfNeeded(emptyOptAgent1, 'pressure', SIGNAL)).toBeNull()
    expect(await engine.compactIfNeeded(emptyOptAgent2, 'pressure', SIGNAL)).toBeNull()

    // Context-overflow with plan null returns null
    const unbalSess = Session.create(SessionId('unbal-co'))
    appendSystem(unbalSess, 'System')
    unbalSess.append('turn/start', { turn: 1 })
    unbalSess.append('step/start', { turn: 1, step: 1 })
    unbalSess.append('assistant/message', {
      stream: [],
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'c1' as never, name: 'bash', arguments: '{}' }],
        source: { kind: 'model', provider: MODEL, model: MODEL },
      }),
    }, { surfaceOp: 'append' })
    const unbalAgent = { session: unbalSess, options: { provider: MODEL, model: MODEL } } as unknown as Agent
    expect(await engine.compactIfNeeded(unbalAgent, 'context-overflow', SIGNAL)).toBeNull()

    // Missing context throws TargetPressureConfigError
    const noCapCtx = createContext()
    vi.spyOn(noCapCtx.llm, 'resolveModelInfo').mockResolvedValueOnce({
      provider: MODEL,
      id: MODEL,
      name: MODEL,
    })
    const engineNoCap = new RecallableCompactionEngine(noCapCtx)
    await expect(engineNoCap.compactIfNeeded(agent, 'pressure', SIGNAL)).rejects.toThrow(TargetPressureConfigError)
  })

  it('compactRegion covers edge cases and fallback to config', async () => {
    const ctx = createContext(10_000, 'Region summary\nKeywords: region')
    const engine = new RecallableCompactionEngine(ctx, {
      summarizationProvider: 'default',
      summarizationModel: 'default',
    })
    const session = conversation(4, 'Region message text', 'System')
    const noTgtAgent = {
      session,
      options: {},
    } as unknown as Agent
    const nodes = session.surface.nodes
    const result = await engine.compactRegion(nodes[2]!, nodes[3]!, noTgtAgent, SIGNAL)
    expect(result).not.toBeNull()

    // Unable to partition range throws error
    const unbalSessRegion = Session.create(SessionId('unbal-region'))
    appendSystem(unbalSessRegion, 'System')
    unbalSessRegion.append('turn/start', { turn: 1 })
    unbalSessRegion.append('step/start', { turn: 1, step: 1 })
    unbalSessRegion.append('assistant/message', {
      stream: [],
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'tool-call', id: 'c1' as never, name: 'bash', arguments: '{}' }],
        source: { kind: 'model', provider: MODEL, model: MODEL },
      }),
    }, { surfaceOp: 'append' })
    const unbalAg = { session: unbalSessRegion, options: {} } as unknown as Agent
    const uNodes = unbalSessRegion.surface.nodes
    await expect(engine.compactRegion(uNodes[0]!, uNodes[1]!, unbalAg, SIGNAL)).rejects.toThrow(/unable to partition range/)

    // Inflation abort error in compactRegion with fresh session
    const inflatingCtx = createContext(10_000, 'X'.repeat(50_000))
    const inflatingEngine = new RecallableCompactionEngine(inflatingCtx, {
      summarizationProvider: 'default',
      summarizationModel: 'default',
    })
    const freshSession = conversation(4, 'Region message text', 'System')
    const freshNodes = freshSession.surface.nodes
    const freshAgent = { session: freshSession, options: {} } as unknown as Agent
    await expect(inflatingEngine.compactRegion(freshNodes[1]!, freshNodes[3]!, freshAgent, SIGNAL)).rejects.toThrow(/inflation guard/)
  })

  it('findOpenTurn returns open turn or null when closed or absent', () => {
    const session = Session.create(SessionId('turn-test'))
    expect(findOpenTurn(session)).toBeNull()

    session.append('turn/start', { turn: 1 })
    expect(findOpenTurn(session)).toBe(1)

    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(findOpenTurn(session)).toBeNull()
  })
})
