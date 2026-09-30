/**
 * Concurrent chunk stub and state summarization with degradation fallbacks.
 *
 * @module @deepseek-ai/dsh-compact-recallable/summarizer
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  createUserMessage,
  createSystemMessage,
  BlockAssembler,
  LlmError,
} from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock,
  GenerateOptions,
  Message,
} from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { INDEX_STUB_INSTRUCTION, STATE_SUMMARIZATION_INSTRUCTION } from './prompts.ts'
import type { ChunkSlice, StateSummaryResult, StubSummaryResult } from './types.ts'

interface SummarizerConfig {
  readonly summarizationProvider: string
  readonly summarizationModel: string
  readonly maxTokens: number
}

function resolveTarget(
  agent: Agent,
  config: SummarizerConfig,
): { provider: string; model: string } {
  const configured = config.summarizationProvider.length > 0 && config.summarizationModel.length > 0
    ? { provider: config.summarizationProvider, model: config.summarizationModel }
    : undefined
  const latest = agent.session.requestHeader()?.config
  const agentTarget = agent.options.provider !== undefined && agent.options.provider.length > 0
    && agent.options.model !== undefined && agent.options.model.length > 0
    ? { provider: agent.options.provider, model: agent.options.model }
    : undefined
  const target = configured ?? latest ?? agentTarget
  if (target === undefined) {
    throw new Error(
      'no provider/model available for summarization: set summarizationProvider/Model or configure agent',
    )
  }
  return target
}

function extractText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map(b => b.text)
    .join('\n')
}

/**
 * Summarize an index chunk into a terse index stub (~100-200 tokens).
 * If the chunk consists entirely of recalled content, emits a code-only pointer.
 * If the LLM stream call fails, degrades to a code-composed fallback stub.
 */
export async function summarizeChunk(
  ctx: Context,
  config: SummarizerConfig,
  chunk: ChunkSlice,
  agent: Agent,
  messages: readonly Message[],
  priorStateText?: string,
  priorKeywords: readonly string[] = [],
  signal?: AbortSignal,
): Promise<StubSummaryResult> {
  // 1. Recalled-only degradation: no LLM call needed
  if (chunk.isRecalledOnly) {
    return {
      summary: [{
        type: 'text',
        text: `Recalled conversation history from checkpoint span #${chunk.startSeq}–#${chunk.endSeq}.\nKeywords: history_read; history_search; recalled-content`,
      }],
      keywords: ['history_read', 'history_search', 'recalled-content'],
      provider: 'code',
      model: 'code',
    }
  }

  const target = resolveTarget(agent, config)

  // 2. Prepare layered input:
  // - Background: prior state checkpoint & previous keywords
  // - Chunk messages
  // - Instruction user message
  const promptMessages: Message[] = []
  if (priorStateText !== undefined && priorStateText.trim().length > 0) {
    promptMessages.push(createSystemMessage(
      `Prior working memory context:\n${priorStateText}`,
    ))
  }
  if (priorKeywords.length > 0) {
    promptMessages.push(createSystemMessage(
      `Already indexed keywords directory (do not repeat unless key):\n${priorKeywords.join(', ')}`,
    ))
  }
  promptMessages.push(...messages)
  promptMessages.push(createUserMessage({
    content: [{ type: 'text', text: INDEX_STUB_INSTRUCTION }],
    source: { kind: 'user' },
  }))

  try {
    const assembler = new BlockAssembler()
    const options: GenerateOptions = {
      provider: target.provider,
      model: target.model,
      messages: promptMessages,
      maxTokens: config.maxTokens,
      sessionId: agent.session.id,
      purpose: 'compaction',
      ...signal === undefined ? {} : { signal },
    }

    for await (const chunkBlock of ctx.llm.stream(options)) {
      assembler.push(chunkBlock)
    }

    const rawOutput = assembler.blocks()
    const text = extractText(rawOutput)
    if (text.trim().length === 0) {
      throw new Error('chunk summarization produced empty output')
    }

    // Parse keywords line if present
    const lines = text.split('\n')
    const kwLine = lines.find(l => l.toLowerCase().startsWith('keywords:'))
    const keywords = kwLine
      ? kwLine.replace(/^[Kk]eywords:\s*/, '').split(/;|,/).map(k => k.trim()).filter(Boolean)
      : []

    return {
      summary: rawOutput.filter(b => b.type === 'text'),
      keywords,
      provider: target.provider,
      model: target.model,
      ...assembler.usage !== undefined ? { usage: assembler.usage } : {},
    }
  } catch (error: unknown) {
    // 3. Failed stub call degrades to code-composed fallback stub
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger.warn(`chunk #${chunk.startSeq}–#${chunk.endSeq} stub generation failed (${message}); degrading to code-composed fallback stub`)
    return {
      summary: [{
        type: 'text',
        text: `Earlier conversation span #${chunk.startSeq}–#${chunk.endSeq} (code-composed fallback stub).\nKeywords: span-#${chunk.startSeq}; chunk-fallback`,
      }],
      keywords: [`span-#${chunk.startSeq}`, 'chunk-fallback'],
      provider: 'code-fallback',
      model: 'code-fallback',
    }
  }
}

/**
 * Summarize the active working-memory state checkpoint.
 * Merges prior state and newly staled messages into one structured document.
 */
export async function summarizeState(
  ctx: Context,
  config: SummarizerConfig,
  agent: Agent,
  staledMessages: readonly Message[],
  signal?: AbortSignal,
): Promise<StateSummaryResult> {
  const target = resolveTarget(agent, config)

  const messages: Message[] = [
    ...staledMessages,
    createUserMessage({
      content: [{ type: 'text', text: STATE_SUMMARIZATION_INSTRUCTION }],
      source: { kind: 'user' },
    }),
  ]

  const assembler = new BlockAssembler()
  const options: GenerateOptions = {
    provider: target.provider,
    model: target.model,
    messages,
    maxTokens: config.maxTokens,
    sessionId: agent.session.id,
    purpose: 'compaction',
    ...signal === undefined ? {} : { signal },
  }

  for await (const chunkBlock of ctx.llm.stream(options)) {
    assembler.push(chunkBlock)
  }

  if (assembler.finish.kind === 'error' || assembler.finish.kind === 'aborted') {
    throw new LlmError(assembler.finish.failure.message, assembler.finish.failure.code, assembler.finish.failure)
  }

  const rawOutput = assembler.blocks()
  const summary = rawOutput.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
  if (!summary.some(b => b.text.trim().length > 0)) {
    throw new Error('state checkpoint summarization produced no text content')
  }

  return {
    summary,
    provider: target.provider,
    model: target.model,
    ...assembler.usage !== undefined ? { usage: assembler.usage } : {},
  }
}
