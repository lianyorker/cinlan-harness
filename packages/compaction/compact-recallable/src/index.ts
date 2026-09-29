/**
 * Recallable compaction backend featuring frozen index stubs, mutable state checkpoint,
 * and concurrent summarization with strictly ordered left-to-right commit.
 *
 * @module @deepseek-ai/dsh-compact-recallable
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  CompactionEngine,
  CompactionId,
  compactCheckpointSource,
  isCompactCheckpointSource,
  formatCheckpointFooter,
} from '@deepseek-ai/dsh-compaction'
import type { CompactionResult, CompactionTrigger } from '@deepseek-ai/dsh-compaction'
import { CONTEXT_WINDOW_EXCEEDED_CODE, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, LlmCallConfig, Message, MessageSource } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type Session } from '@deepseek-ai/dsh-session'
import { estimateContent } from '@deepseek-ai/dsh-token-meter/estimate'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type {} from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import {
  resolveCompactSpec,
  resolveConfig,
  resolveTargetPolicy,
  TargetPressureConfigError,
} from './config.ts'
import { selectPartitionPlan } from './chunking.ts'
import { summarizeChunk, summarizeState } from './summarizer.ts'
import { STATE_CHECKPOINT_PREAMBLE } from './prompts.ts'
import type {
  ModelCompactPolicyConfig,
  PartitionPlan,
  RecallableCompactionConfig,
  ResolvedConfig,
} from './types.ts'

export type * from './types.ts'
export { TargetPressureConfigError } from './config.ts'
export * from './chunking.ts'
export * from './summarizer.ts'
export * from './prompts.ts'

function routedTarget(
  session: Session,
): Pick<LlmCallConfig, 'provider' | 'model'> | undefined {
  const config = session.requestHeader()?.config
  if (config === undefined || config.provider.length === 0 || config.model.length === 0) {
    return undefined
  }
  return { provider: config.provider, model: config.model }
}

function conversationTarget(
  agent: Agent,
): Pick<LlmCallConfig, 'provider' | 'model'> | undefined {
  const routed = routedTarget(agent.session)
  if (routed !== undefined) return routed
  if (agent.options.provider === undefined || agent.options.provider.length === 0
    || agent.options.model === undefined || agent.options.model.length === 0) return undefined
  return { provider: agent.options.provider, model: agent.options.model }
}

function renderText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('\n')
}

const modelPolicy: z<ModelCompactPolicyConfig> = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  thresholdRatio: z.number(),
  retainRatio: z.number(),
  retainTokens: z.number().step(1).min(0),
  chunkTokens: z.number().step(1).min(100),
  stubTokens: z.number().step(1).min(20),
  summarizationProvider: z.string(),
  summarizationModel: z.string(),
  maxTokens: z.number().step(1).min(1),
  compactionRetries: z.number().step(1).min(0),
  maxOverflowRetries: z.number().step(1).min(0),
})

/** Inspect open turn for compaction transaction. */
export function findOpenTurn(session: Session): number | null {
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const event = session.eventAt(SessionSeq(seq))!
    if (event.type === 'turn/start') return event.data.turn
    if (event.type === 'turn/end') return null
  }
  return null
}

/**
 * Recallable compaction engine: partitions stale history into frozen index stubs
 * and a mutable state checkpoint, preserving keyless replay and recallability.
 */
export class RecallableCompactionEngine extends CompactionEngine {
  static inject = ['llm', 'tokenMeter', 'sessions']

  static Config: z<RecallableCompactionConfig> = z.object({
    thresholdRatio: z.number(),
    retainRatio: z.number(),
    retainTokens: z.number().step(1).min(0),
    chunkTokens: z.number().step(1).min(100),
    stubTokens: z.number().step(1).min(20),
    summarizationProvider: z.string(),
    summarizationModel: z.string(),
    maxTokens: z.number().step(1).min(1),
    compactionRetries: z.number().step(1).min(0),
    maxOverflowRetries: z.number().step(1).min(0),
    modelPolicies: z.array(modelPolicy),
    auto: z.boolean(),
  })

  readonly config: ResolvedConfig
  private readonly warnedPressureConfigTargets = new Set<string>()
  private readonly overflowRetries = new WeakMap<Agent, number>()
  private readonly overflowAgents = new WeakMap<Session, Agent>()

  constructor(ctx: Context, config: RecallableCompactionConfig = {}) {
    super(ctx)
    this.config = resolveConfig(config)
    if (this.config.auto) this._registerAutomaticCompaction()
  }

  private _registerAutomaticCompaction(): void {
    const { ctx } = this
    const logResult = (result: CompactionResult, trigger: string): void => {
      ctx.logger.info(
        `recallable compaction (${trigger}): shadowed ${result.shadowedSeqs.length} surface nodes `
        + `(seqs ${result.shadowedRange.start}-${result.shadowedRange.end}, `
        + `~${result.shadowedTokenCount} tokens)`,
      )
    }

    ctx.on('agent/pre-step', async (
      { agent, signal },
      next,
    ): Promise<PreStepDecision> => {
      if (!signal.aborted) {
        try {
          const result = await this.compactIfNeeded(agent, 'pressure', signal)
          if (result !== null) logResult(result, 'step pressure')
        } catch (error: unknown) {
          if (error instanceof TargetPressureConfigError) {
            if (this.warnedPressureConfigTargets.has(error.targetKey)) return next()
            this.warnedPressureConfigTargets.add(error.targetKey)
          }
          const message = error instanceof Error ? error.message : String(error)
          ctx.logger.warn(`step compaction failed: ${message}; continuing the turn`)
        }
      }
      return next()
    })

    ctx.on('agent/status', ({ agent, status }) => {
      if (status === 'idle') this.overflowRetries.delete(agent)
    })

    ctx.on('session/event', (session, event) => {
      if (event.type !== 'assistant/message') return
      const agent = this.overflowAgents.get(session)
      if (agent !== undefined) this.overflowRetries.delete(agent)
    })

    ctx.on('agent/request-error', async (
      { agent, failure, signal },
      next,
    ) => {
      if (failure.code !== CONTEXT_WINDOW_EXCEEDED_CODE || signal.aborted) return next()
      this.overflowAgents.set(agent.session, agent)
      const target = routedTarget(agent.session)
      if (target === undefined) return next()
      const policy = resolveTargetPolicy(this.config, target)
      const retries = this.overflowRetries.get(agent) ?? 0
      if (retries >= policy.maxOverflowRetries) return next()

      const generation = agent.session.surface.replaceGeneration
      let result: CompactionResult | null
      try {
        result = await this.compactIfNeeded(agent, 'context-overflow', signal)
      } catch (recoveryError: unknown) {
        const message = recoveryError instanceof Error ? recoveryError.message : String(recoveryError)
        if (!signal.aborted && agent.session.surface.replaceGeneration > generation) {
          ctx.logger.warn(
            `context-overflow compaction failed after surface progress: ${message}; retrying`,
          )
          this.overflowRetries.set(agent, retries + 1)
          return { kind: 'retry' }
        }
        ctx.logger.warn(`context-overflow compaction failed: ${message}`)
        return next()
      }
      if (signal.aborted || agent.session.surface.replaceGeneration <= generation) return next()
      if (result !== null) logResult(result, 'context overflow recovery')
      this.overflowRetries.set(agent, retries + 1)
      return { kind: 'retry' }
    })
  }

  override async compactIfNeeded(
    agent: Agent,
    trigger: CompactionTrigger,
    signal: AbortSignal,
  ): Promise<CompactionResult | null> {
    const target = routedTarget(agent.session) ?? conversationTarget(agent)
    if (target === undefined) return null
    const policy = resolveTargetPolicy(this.config, target)
    const meter = this.ctx.tokenMeter
    let measurement = meter.measure(agent.session)

    const prune = this.ctx.get('toolResultPruner')
    if (prune !== undefined) {
      prune.pruneSession(agent.session)
      measurement = meter.measure(agent.session)
    }

    if (trigger === 'context-overflow') {
      const plan = selectPartitionPlan(agent.session, measurement, policy.chunkTokens, 0)
      if (plan === null) return null
      return this.executeCompactionPass(agent, plan, policy, signal)
    }

    const context = (await this.ctx.llm.resolveModelInfo(target.provider, target.model, signal)).context
    const targetKey = `${target.provider}/${target.model}`
    if (context === undefined) {
      throw new TargetPressureConfigError(
        targetKey,
        `compact-recallable: no context capacity for ${targetKey}; configure contextWindow on that adapter`,
      )
    }

    const spec = resolveCompactSpec(policy, context.contextWindow)
    if (measurement.totalTokens < spec.thresholdTokens) return null

    let result: CompactionResult | null = null
    for (let attempt = 0; attempt <= spec.compactionRetries; attempt++) {
      const plan = selectPartitionPlan(agent.session, measurement, spec.chunkTokens, spec.retainTokens)
      if (plan === null) return result
      result = await this.executeCompactionPass(agent, plan, policy, signal)
      if (result === null) return null
      measurement = meter.measure(agent.session)
      if (measurement.totalTokens < spec.thresholdTokens) return result
    }

    return result
  }

  private async executeCompactionPass(
    agent: Agent,
    plan: PartitionPlan,
    policy: {
      summarizationProvider: string
      summarizationModel: string
      maxTokens: number
      stubTokens: number
    },
    signal?: AbortSignal,
    sourceCommandId?: CommandId,
  ): Promise<CompactionResult | null> {
    const session = agent.session
    // Map surface nodes to derived messages
    const surfaceSeqToMessage = new Map<SessionSeq, Message>()
    for (const seq of session.surface.nodes) {
      // Surface sequences are built from the log — seq is always a valid index by construction.
      // oxlint-disable-next-line typescript/no-non-null-assertion
      const msg = session.deriveEventMessage(session.eventAt(seq)!)
      if (msg !== null) {
        surfaceSeqToMessage.set(seq, msg)
      }
    }

    // Extract prior state checkpoint text if present
    let priorStateText: string | undefined
    const firstSeq = plan.compactableStartSeq
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const firstEvent = session.eventAt(firstSeq)!
    const firstSource = firstEvent.type === 'user/message' ? (firstEvent.data as { source?: MessageSource }).source : undefined
    if (firstSource !== undefined && isCompactCheckpointSource(firstSource)) {
      // oxlint-disable-next-line typescript/no-non-null-assertion
      priorStateText = renderText(surfaceSeqToMessage.get(firstSeq)!.content)
    }

    // Collect keywords from previously committed stubs
    const priorKeywords: string[] = []
    for (const seq of session.surface.nodes) {
      if (seq === plan.compactableStartSeq) break
      // oxlint-disable-next-line typescript/no-non-null-assertion
      const event = session.eventAt(seq)!
      const source = event.type === 'user/message' ? (event.data as { source?: MessageSource }).source : undefined
      if (source !== undefined && isCompactCheckpointSource(source)) {
        // oxlint-disable-next-line typescript/no-non-null-assertion
        const text = renderText(surfaceSeqToMessage.get(seq)!.content)
        const kwMatch = text.match(/[Kk]eywords:\s*([^\n]+)/)
        if (kwMatch?.[1]) {
          priorKeywords.push(...kwMatch[1].split(/;|,/).map(k => k.trim()).filter(Boolean))
        }
      }
    }

    // Phase 1: Concurrent Summarization
    const chunkPromises = plan.chunks.map((chunk) => {
      const chunkMessages: Message[] = []
      for (const seq of chunk.shadowedSeqs) {
        const m = surfaceSeqToMessage.get(seq)
        if (m !== undefined) chunkMessages.push(m)
      }
      return summarizeChunk(
        this.ctx,
        policy,
        chunk,
        agent,
        chunkMessages,
        priorStateText,
        priorKeywords,
        signal,
      )
    })

    const staledMessages: Message[] = []
    const allShadowedSeqs: SessionSeq[] = [
      ...plan.chunks.flatMap(c => c.shadowedSeqs),
      ...plan.trailingSlice.shadowedSeqs,
    ]
    for (const seq of allShadowedSeqs) {
      const m = surfaceSeqToMessage.get(seq)
      if (m !== undefined) staledMessages.push(m)
    }

    const statePromise = summarizeState(
      this.ctx,
      policy,
      agent,
      staledMessages,
      signal,
    )

    const [chunkResults, stateResult] = await Promise.all([
      Promise.all(chunkPromises),
      statePromise,
    ])

    // Phase 2: Inflation Guard
    // If post-compaction size is not strictly below pre-compaction size, abort pass.
    let preCompactionTokens = 0
    for (const chunk of plan.chunks) preCompactionTokens += chunk.estimatedTokens
    preCompactionTokens += plan.trailingSlice.estimatedTokens

    let postCompactionTokens = 0
    for (const stub of chunkResults) {
      postCompactionTokens += estimateContent(stub.summary)
    }
    postCompactionTokens += estimateContent(stateResult.summary)

    if (postCompactionTokens >= preCompactionTokens) {
      this.ctx.logger.info(
        `inflation guard: post-compaction size (~${postCompactionTokens} tokens) >= `
        + `pre-compaction size (~${preCompactionTokens} tokens); aborting compaction pass`,
      )
      return null
    }

    // Phase 3: Sequential left-to-right commit
    const turn = findOpenTurn(session)
    let lastResult: CompactionResult | null = null

    // 1. Commit each chunk stub
    for (let i = 0; i < plan.chunks.length; i++) {
      // oxlint-disable-next-line typescript/no-non-null-assertion
      const chunk = plan.chunks[i]!
      // oxlint-disable-next-line typescript/no-non-null-assertion
      const stub = chunkResults[i]!
      const compactionId = CompactionId(randomUUID())

      const startEvent = session.append('compaction/start', {
        compactionId,
        ...sourceCommandId !== undefined ? { sourceCommandId } : {},
        turn,
      })

      const summaryEvent = session.append('compaction/summary', {
        compactionId,
        ...sourceCommandId !== undefined ? { sourceCommandId } : {},
        summary: stub.summary,
        shadowedRange: { start: chunk.startSeq, end: chunk.endSeq },
        shadowedSeqs: [...chunk.shadowedSeqs],
        shadowedTokenCount: chunk.estimatedTokens,
        provider: stub.provider,
        model: stub.model,
        maxTokens: policy.maxTokens,
        ...stub.usage !== undefined ? { usage: stub.usage } : {},
        checkpointKind: 'index',
      })

      const footer = formatCheckpointFooter(summaryEvent.seq, chunk.startSeq, chunk.endSeq)
      const stubText = renderText(stub.summary) + '\n\n' + footer

      session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: stubText }],
        source: compactCheckpointSource(compactionId, sourceCommandId),
      }), {
        surfaceOp: { op: 'replace', startSeq: chunk.startSeq, endSeq: chunk.endSeq },
        sourceEventSeqs: [...chunk.shadowedSeqs],
      })

      const endEvent = session.append('compaction/end', {
        compactionId,
        ...sourceCommandId !== undefined ? { sourceCommandId } : {},
        turn,
      })

      lastResult = {
        compactionId,
        ...sourceCommandId !== undefined ? { sourceCommandId } : {},
        startSeq: startEvent.seq,
        summarySeq: summaryEvent.seq,
        endSeq: endEvent.seq,
        summary: stub.summary,
        shadowedRange: { start: chunk.startSeq, end: chunk.endSeq },
        shadowedSeqs: [...chunk.shadowedSeqs],
        shadowedTokenCount: chunk.estimatedTokens,
        checkpointKind: 'index',
      }
    }

    // 2. Commit trailing slice as mutable state checkpoint
    const stateCompactionId = CompactionId(randomUUID())
    const trailing = plan.trailingSlice

    const stateStartEvent = session.append('compaction/start', {
      compactionId: stateCompactionId,
      ...sourceCommandId !== undefined ? { sourceCommandId } : {},
      turn,
    })

    const stateSummaryEvent = session.append('compaction/summary', {
      compactionId: stateCompactionId,
      ...sourceCommandId !== undefined ? { sourceCommandId } : {},
      summary: stateResult.summary,
      shadowedRange: { start: plan.compactableStartSeq, end: trailing.endSeq },
      shadowedSeqs: [...trailing.shadowedSeqs],
      shadowedTokenCount: trailing.estimatedTokens,
      provider: stateResult.provider,
      model: stateResult.model,
      maxTokens: policy.maxTokens,
      ...stateResult.usage !== undefined ? { usage: stateResult.usage } : {},
      checkpointKind: 'state',
    })

    const stateFooter = formatCheckpointFooter(stateSummaryEvent.seq, plan.compactableStartSeq, trailing.endSeq)
    const stateFullText = `${STATE_CHECKPOINT_PREAMBLE}\n\n${renderText(stateResult.summary)}\n\n${stateFooter}`

    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: stateFullText }],
      source: compactCheckpointSource(stateCompactionId, sourceCommandId),
    }), {
      surfaceOp: { op: 'replace', startSeq: trailing.startSeq, endSeq: trailing.endSeq },
      sourceEventSeqs: [...trailing.shadowedSeqs],
    })

    const stateEndEvent = session.append('compaction/end', {
      compactionId: stateCompactionId,
      ...sourceCommandId !== undefined ? { sourceCommandId } : {},
      turn,
    })

    lastResult = {
      compactionId: stateCompactionId,
      ...sourceCommandId !== undefined ? { sourceCommandId } : {},
      startSeq: stateStartEvent.seq,
      summarySeq: stateSummaryEvent.seq,
      endSeq: stateEndEvent.seq,
      summary: stateResult.summary,
      shadowedRange: { start: plan.compactableStartSeq, end: trailing.endSeq },
      shadowedSeqs: [...trailing.shadowedSeqs],
      shadowedTokenCount: trailing.estimatedTokens,
      checkpointKind: 'state',
    }

    return lastResult
  }

  override async compactRegion(
    start: SessionSeq,
    end: SessionSeq,
    agent: Agent,
    signal?: AbortSignal,
  ): Promise<CompactionResult> {
    const target = conversationTarget(agent)
    const policy = target === undefined ? this.config : resolveTargetPolicy(this.config, target)
    const nodes = agent.session.surface.nodes
    const startIdx = nodes.indexOf(start)
    const endIdx = nodes.indexOf(end)
    if (startIdx < 0 || endIdx < startIdx) {
      throw new Error(`compactRegion: invalid surface range #${start}–#${end}`)
    }

    const meter = this.ctx.tokenMeter
    const measurement = meter.measure(agent.session)
    const plan = selectPartitionPlan(agent.session, measurement, policy.chunkTokens, 0)
    if (plan === null) {
      throw new Error(`compactRegion: unable to partition range #${start}–#${end}`)
    }

    const result = await this.executeCompactionPass(agent, plan, policy, signal)
    if (result === null) {
      throw new Error('compactRegion: compaction pass aborted by inflation guard')
    }
    return result
  }

  override compactNow(
    agent: Agent,
    signal: AbortSignal,
    sourceCommandId?: CommandId,
  ): Promise<CompactionResult | null> {
    signal.throwIfAborted()
    return agent.runMaintenance(async (agentSignal) => {
      const operationSignal = AbortSignal.any([agentSignal, signal])
      operationSignal.throwIfAborted()
      const target = conversationTarget(agent)
      const policy = target === undefined ? this.config : resolveTargetPolicy(this.config, target)
      const meter = this.ctx.tokenMeter
      const measurement = meter.measure(agent.session)
      const plan = selectPartitionPlan(agent.session, measurement, policy.chunkTokens, 0)
      if (plan === null) return null
      return this.executeCompactionPass(agent, plan, policy, operationSignal, sourceCommandId)
    })
  }
}

export default RecallableCompactionEngine
