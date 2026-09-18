/** Current-format usage logs created only inside a test's private persistence root. */
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import type { AssistantStreamRecord, TokenUsage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'

export const interval = { from: 1_800_000_000_000, to: 1_800_000_001_000 }
export const privateText = 'private conversation text never belongs in a usage response'
export const knownTokens = {
  uncachedInputTokens: 100, outputTokens: 20, totalTokens: 170,
  cacheReadTokens: 50, cacheWriteTokens: 0, reasoningTokens: 8,
}

function turn(seq: number, number: number, time: number, provider: string, model: string, usage?: TokenUsage): SessionEvent[] {
  const stream: AssistantStreamRecord[] = [
    { type: 'chunk', time, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
    { type: 'text-chunks', time0: time, index: 0, dt: [0], texts: [privateText] },
    { type: 'chunk', time, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: privateText } } },
    ...(usage === undefined ? [] : [{ type: 'chunk' as const, time, chunk: { type: 'usage' as const, usage } }]),
    { type: 'chunk', time, chunk: { type: 'finish', reason: { kind: 'stop' } } },
  ]
  return [
    { seq: SessionSeq(seq), time, type: 'turn/start', data: { turn: number } },
    { seq: SessionSeq(seq + 1), time, type: 'step/start', data: { turn: number, step: 1 } },
    {
      seq: SessionSeq(seq + 2), time, type: 'assistant/message', surfaceOp: 'append', data: {
        turn: number, step: 1, stream,
        message: createAssistantMessage({ content: [{ type: 'text', text: privateText }], source: { provider, model } }),
        ...(usage === undefined ? {} : { usage }),
      },
    },
    { seq: SessionSeq(seq + 3), time, type: 'step/end', data: { turn: number, step: 1 } },
    { seq: SessionSeq(seq + 4), time, type: 'turn/end', data: { turn: number, reason: { kind: 'completed' } } },
  ]
}

/**
 * Flush and close cold records containing exact, unknown, and excluded Turns.
 * @param persistence - real JSONL provider rooted in the test's temporary directory.
 * @returns physical fixture paths for byte-preservation assertions.
 */
export async function seedUsageLogs(persistence: SessionPersistenceJsonl): Promise<string[]> {
  const logs: Array<{ id: string; events: SessionEvent[] }> = [
    { id: 'usage-main', events: [
      ...turn(0, 1, interval.from, 'deepseek', 'deepseek-chat', {
        inputTokens: 100, outputTokens: 20, totalTokens: 170, cacheReadTokens: 50, cacheWriteTokens: 0, reasoningTokens: 8,
      }),
      ...turn(5, 2, interval.from + 100, 'deepseek', 'deepseek-chat'),
      ...turn(10, 3, interval.to, 'deepseek', 'deepseek-chat', { inputTokens: 999, outputTokens: 1, totalTokens: 1000 }),
    ] },
    { id: 'usage-other', events: turn(0, 1, interval.from + 200, 'other', 'reasoner', {
      inputTokens: 10, outputTokens: 5, totalTokens: 17, cacheReadTokens: 2, cacheWriteTokens: 0, reasoningTokens: 1,
    }) },
  ]
  const paths: string[] = []
  for (const log of logs) {
    const id = SessionId(log.id)
    const handle = await persistence.create({
      version: SESSION_FORMAT_VERSION, id, createdAt: interval.from - 1, isSeeded: false,
    })
    try {
      await handle.append(log.events)
      await handle.flush()
    } finally {
      await handle.close()
    }
    const path = await persistence.resolveCurrentLog(id)
    if (path === undefined) throw new Error('usage fixture did not persist its current generation')
    paths.push(path)
  }
  return paths
}
