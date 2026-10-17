/** Projection of the Host's durable Session frames into the existing phone transcript. */
import { z } from 'zod'
import type { TrajectoryStep } from '../types'

const EventRecordSchema = z.object({ type: z.literal('event'), event: z.object({ type: z.string(), seq: z.number().int().nonnegative(), time: z.number(), data: z.unknown(), surfaceOp: z.union([z.literal('append'), z.object({ op: z.literal('replace'), startSeq: z.number(), endSeq: z.number() })]).optional() }).passthrough() }).strict()
const ContentSchema = z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
const MessageSchema = z.object({
  id: z.string().optional(),
  source: z.object({ kind: z.string() }).passthrough().optional(),
  content: ContentSchema,
}).passthrough()

function messageData(value: unknown): { message: z.infer<typeof MessageSchema> } | undefined {
  const nested = z.object({ message: MessageSchema }).passthrough().safeParse(value)
  if (nested.success) return { message: nested.data.message }
  const legacy = z.object({ content: ContentSchema }).passthrough().safeParse(value)
  if (legacy.success) return { message: { content: legacy.data.content } }
  return undefined
}

function compactText(stream: unknown[]): { content: string; thought: string } {
  let content = ''; let thought = ''
  for (const record of stream) {
    const item = z.object({ type: z.string(), texts: z.array(z.string()).optional() }).passthrough().safeParse(record)
    if (!item.success) continue
    if (item.data.type === 'reasoning-chunks') thought += item.data.texts?.join('') ?? ''
    if (item.data.type === 'text-chunks') content += item.data.texts?.join('') ?? ''
  }
  return { content, thought }
}

/** Render logged human/assistant messages and tool calls without fabricating Agent output. */
export function transcriptRecord(value: unknown): TrajectoryStep | undefined {
  const parsed = EventRecordSchema.safeParse(value)
  if (!parsed.success) return undefined
  const event = parsed.data.event
  if (event.type === 'user/message') {
    const data = messageData(event.data)
    if (data && (!data.message.source || data.message.source.kind === 'user')) {
      return { id: String(event.seq), role: 'user', content: data.message.content.map(part => part.text ?? '').join(''), timestamp: event.time }
    }
  }
  if (event.type === 'assistant/message') {
    const data = z.object({ stream: z.array(z.unknown()).optional(), message: MessageSchema.optional(), content: ContentSchema.optional() }).passthrough().safeParse(event.data)
    if (data.success) {
      const compact = compactText(data.data.stream ?? [])
      const content = compact.content || data.data.message?.content.map(part => part.text ?? '').join('') || data.data.content?.map(part => part.text ?? '').join('') || ''
      const thought = compact.thought
      return { id: String(event.seq), role: 'assistant', content, thought, timestamp: event.time }
    }
  }
  if (event.type === 'tool/call') {
    const data = z.object({ callId: z.string(), name: z.string(), arguments: z.string() }).passthrough().parse(event.data)
    let args: Record<string, unknown>
    try { args = z.record(z.string(), z.unknown()).parse(JSON.parse(data.arguments)) }
    catch (_invalidModelArguments) { args = { raw: data.arguments } }
    return { id: String(event.seq), role: 'assistant', toolCalls: [{ id: data.callId, tool: data.name, args, state: 'running' }], timestamp: event.time }
  }
  return undefined
}

/** Apply snapshots atomically and deduplicate subsequent events by the durable sequence. */
export function applySessionFrame(steps: TrajectoryStep[], value: unknown): TrajectoryStep[] {
  const snapshot = z.object({ type: z.literal('snapshot'), records: z.array(z.unknown()) }).passthrough().safeParse(value)
  if (snapshot.success) return snapshot.data.records.reduce<TrajectoryStep[]>((current, record) => applySessionFrame(current, record), [])
  const parsed = EventRecordSchema.safeParse(value)
  if (!parsed.success) return steps
  const event = parsed.data.event
  if (event.type === 'tool/result') {
    const result = z.object({ message: z.object({ toolCallId: z.string(), content: z.unknown(), isError: z.boolean().optional() }).passthrough() }).passthrough().parse(event.data).message
    return steps.map(step => ({ ...step, toolCalls: step.toolCalls?.map(call => call.id === result.toolCallId ? { ...call, state: result.isError ? 'failed' : 'completed', result: result.content } : call) }))
  }
  const step = transcriptRecord(value)
  if (!step || steps.some(item => item.id === step.id)) return steps
  const placement = event.surfaceOp
  const remaining = placement && placement !== 'append' ? steps.filter(item => Number(item.id) < placement.startSeq || Number(item.id) > placement.endSeq) : steps
  return [...remaining, step].sort((a, b) => Number(a.id) - Number(b.id))
}

/** Dense process-local stream state, reset by a reconnect baseline. */
export interface MobileStream { thought: string; content: string; revision: number; attemptId?: string; nextIndex: number }

/** Fold an exact reconnect baseline or contiguous live chunks; gaps never append stale text. */
export function applyStreamFrame(current: MobileStream | undefined, value: unknown): MobileStream {
  const previous = current ?? { thought: '', content: '', revision: 0, nextIndex: 0 }
  const snapshot = z.object({ type: z.literal('snapshot'), assistantStream: z.object({ revision: z.number(), activeAttempt: z.object({ attemptId: z.string(), nextIndex: z.number(), stream: z.array(z.unknown()) }).passthrough().optional() }).optional() }).passthrough().safeParse(value)
  if (snapshot.success) {
    const baseline = snapshot.data.assistantStream
    const attempt = baseline?.activeAttempt
    return { ...(attempt ? compactText(attempt.stream) : { thought: '', content: '' }), revision: baseline?.revision ?? 0, nextIndex: attempt?.nextIndex ?? 0, ...(attempt ? { attemptId: attempt.attemptId } : {}) }
  }
  const parsed = z.object({ type: z.literal('assistant-stream'), frame: z.object({ type: z.enum(['start', 'chunk', 'end']), revision: z.number(), attemptId: z.string(), index: z.number().optional(), chunk: z.object({ type: z.string(), text: z.string().optional() }).passthrough().optional() }).passthrough() }).strict().safeParse(value)
  if (!parsed.success) return previous
  const frame = parsed.data.frame
  if (frame.type === 'start') return { thought: '', content: '', revision: frame.revision, attemptId: frame.attemptId, nextIndex: 0 }
  if (frame.type === 'end' || frame.revision !== previous.revision + 1 || frame.attemptId !== previous.attemptId || frame.index !== previous.nextIndex) return { thought: '', content: '', revision: frame.revision, nextIndex: 0 }
  return { ...previous, revision: frame.revision, nextIndex: previous.nextIndex + 1, content: previous.content + (frame.chunk?.type === 'text-delta' ? frame.chunk.text ?? '' : ''), thought: previous.thought + (frame.chunk?.type === 'reasoning-delta' ? frame.chunk.text ?? '' : '') }
}
