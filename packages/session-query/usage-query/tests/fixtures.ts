import { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionLogOffset, SessionSeq, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionEventMap, SessionEventType, SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SqliteSessionQueryEngine from '@deepseek-ai/dsh-session-query-sqlite'
import { RetryId } from '@deepseek-ai/dsh-llm-retry'
import UsageQueryService from '../src/index.ts'
import type { Config } from '../src/index.ts'

export function event<T extends SessionEventType>(seq: number, type: T, data: SessionEventMap[T], time = 1000 + seq): SessionEvent<T> {
  // Each fixture message explicitly owns an append surface operation.
  return { seq: SessionSeq(seq), type, data, time, ...(type === 'assistant/message' ? { surfaceOp: 'append' } : {}) } as SessionEvent<T>
}

export function usage(totalTokens = 170): TokenUsage {
  return { inputTokens: 100, outputTokens: 20, cacheReadTokens: totalTokens - 120, totalTokens }
}

export function message(seq: number, tokenUsage: TokenUsage | undefined = usage(), provider = 'deepseek', model = 'chat', turn = 1, step = 1): SessionEvent<'assistant/message'> {
  return event(seq, 'assistant/message', {
    turn, step, message: createAssistantMessage({ content: [{ type: 'text', text: 'private fixture answer' }], source: { provider, model } }),
    stream: tokenUsage === undefined ? [] : [{ type: 'chunk', time: 1000 + seq, chunk: { type: 'usage', usage: tokenUsage } }],
    ...(tokenUsage === undefined ? {} : { usage: tokenUsage }),
  })
}

export function completeTurn(offset = 0, turn = 1, tokenUsage = usage(), provider = 'deepseek', model = 'chat'): SessionEvent[] {
  return [
    event(offset, 'turn/start', { turn }),
    event(offset + 1, 'step/start', { turn, step: 1 }),
    message(offset + 2, tokenUsage, provider, model, turn),
    event(offset + 3, 'step/end', { turn, step: 1 }),
    event(offset + 4, 'turn/end', { turn, reason: { kind: 'completed' } }),
  ]
}

export function retryTurn(): SessionEvent[] {
  const retryId = RetryId('usage-fixture-retry')
  return [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'step/start', { turn: 1, step: 1 }),
    event(2, 'assistant/attempt', {
      turn: 1, step: 1, stream: [
        { type: 'chunk', time: 1002, chunk: { type: 'usage', usage: usage() } },
        { type: 'chunk', time: 1003, chunk: { type: 'finish', reason: { kind: 'error', failure: { code: 'HTTP', message: 'fixture retry' } } } },
      ],
    }),
    event(3, 'llm/retry', { retryId, turn: 1, step: 1, provider: 'deepseek', mode: 'normal', policyKey: 'http', retry: 1, maxRetries: 1, delayMs: 0, failure: { code: 'HTTP', message: 'fixture retry' } }),
    event(4, 'llm/retry-started', { retryId, turn: 1, step: 1, retry: 1 }),
    message(5, { inputTokens: 40, outputTokens: 10, totalTokens: 70, cacheReadTokens: 20 }),
    event(6, 'step/end', { turn: 1, step: 1 }),
    event(7, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

export function header(id: string, cwd: string, inherited = false): SessionHeader {
  return { id: SessionId(id), version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: inherited, cwd }
}

export async function context(root: string, config: Partial<Config> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(SqliteSessionQueryEngine, { path: ':memory:', openAt: 'never' })
  await ctx.plugin(UsageQueryService, { ...UsageQueryService.Config(), ...config })
  return ctx
}

export async function persist(ctx: Context, meta: SessionHeader, events: readonly SessionEvent[], inheritedEventCount = 0): Promise<void> {
  const handle = await ctx.sessionPersistence.create(meta, { inheritedEventCount: SessionLogOffset(inheritedEventCount) })
  try {
    await handle.append(events)
    await handle.flush()
  } finally {
    await handle.close()
  }
}
