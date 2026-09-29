/**
 * Session log transcript rendering and checkpoint location for history recall.
 * @module @deepseek-ai/dsh-tool-recall/transcript
 */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import { isCompactCheckpointSource } from '@deepseek-ai/dsh-compaction'
import { RecallError } from './errors.ts'

/**
 * Render a collection of content blocks to plain text.
 * @param blocks - content blocks from a surface message.
 * @returns rendered plain text.
 */
export function renderBlocks(blocks: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push(block.text)
    } else if (block.type === 'tool-call') {
      parts.push(`[Tool call: ${block.name}(${block.arguments})]`)
    } else if (block.type === 'tool-result') {
      const text = block.content.map(c => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n')
      parts.push(block.isError === true ? `[Tool error: ${text}]` : text)
    }
  }
  return parts.join('\n')
}

/**
 * Render one derived surface message to standard transcript format.
 * Prior state checkpoints are labeled `[prior state checkpoint]` and preserve their footers.
 * Tool results are labeled `Tool result: ...`.
 * Prompts are labeled `User: ...`.
 * Assistant replies are labeled `Assistant: ...`.
 * @param message - derived surface message.
 * @returns formatted transcript text.
 */
export function renderMessage(message: Message): string {
  const body = renderBlocks(message.content)
  if (message.role === 'user') {
    if (isCompactCheckpointSource(message.source)) {
      return `[prior state checkpoint]\n${body}`
    }
    if (message.source.kind === 'tool') {
      return `Tool result: ${body}`
    }
    return `User: ${body}`
  }
  if (message.role === 'assistant') {
    return `Assistant: ${body}`
  }
  return `System: ${body}`
}

/** Checkpoint descriptor resolved from the session log. */
export interface ResolvedCheckpoint {
  readonly id: string
  readonly summarySeq: number
  readonly summaryEvent: SessionEvent<'compaction/summary'>
}

/**
 * Parse a checkpoint identifier (e.g. "c42" or "42") into its numeric summary seq.
 * @param id - user-provided checkpoint string.
 * @returns numeric summary sequence.
 */
export function parseCheckpointId(id: string): number {
  const match = /^c?(\d+)$/i.exec(id.trim())
  const digits = match?.[1]
  if (digits === undefined) {
    throw new RecallError(`invalid checkpoint identifier: ${JSON.stringify(id)}`, 'INVALID_ARGUMENT')
  }
  return Number.parseInt(digits, 10)
}

/**
 * Locate all valid completed checkpoints in a session log.
 * Incomplete or errored transactions are excluded.
 * @param session - target session.
 * @returns list of completed checkpoints in chronological order.
 */
export function findCompletedCheckpoints(session: Session): ResolvedCheckpoint[] {
  const events = session.snapshotEvents()
  const summaries = events.filter((e): e is SessionEvent<'compaction/summary'> => e.type === 'compaction/summary')
  const completed: ResolvedCheckpoint[] = []

  for (const summary of summaries) {
    const end = events.find(
      (e): e is SessionEvent<'compaction/end'> =>
        e.type === 'compaction/end' && e.data.compactionId === summary.data.compactionId,
    )
    if (end && !end.data.error) {
      completed.push({
        id: `c${summary.seq}`,
        summarySeq: summary.seq,
        summaryEvent: summary,
      })
    }
  }

  return completed
}

/**
 * Locate one specific checkpoint by ID, verifying it is neither missing nor orphaned.
 * @param session - target session.
 * @param id - checkpoint string (e.g. "c42" or "42").
 * @returns resolved checkpoint descriptor.
 */
export function resolveCheckpoint(session: Session, id: string): ResolvedCheckpoint {
  const seq = parseCheckpointId(id)
  const events = session.snapshotEvents()

  // Look for the compaction/summary event with seq === seq
  const summaryEvent = events.find(
    (e): e is SessionEvent<'compaction/summary'> => e.type === 'compaction/summary' && e.seq === seq,
  )

  if (!summaryEvent) {
    const startEvent = events.find(
      (e): e is SessionEvent<'compaction/start'> => e.type === 'compaction/start' && e.seq === seq,
    )
    if (startEvent) {
      throw new RecallError(
        `checkpoint c${seq} is an orphaned compaction start without a completed summary`,
        'ORPHANED_COMPACTION',
      )
    }
    throw new RecallError(`checkpoint c${seq} does not exist in this session`, 'CHECKPOINT_NOT_FOUND')
  }

  const endEvent = events.find(
    (e): e is SessionEvent<'compaction/end'> =>
      e.type === 'compaction/end' && e.data.compactionId === summaryEvent.data.compactionId,
  )

  if (!endEvent || endEvent.data.error) {
    throw new RecallError(
      `checkpoint c${seq} belongs to an orphaned or failed compaction`,
      'ORPHANED_COMPACTION',
    )
  }

  return {
    id: `c${summaryEvent.seq}`,
    summarySeq: summaryEvent.seq,
    summaryEvent,
  }
}

/**
 * Extract and render all surface messages shadowed by a checkpoint.
 * @param session - target session.
 * @param checkpoint - resolved checkpoint descriptor.
 * @returns list of rendered message transcript strings in surface order.
 */
export function getShadowedMessages(session: Session, checkpoint: ResolvedCheckpoint): string[] {
  const rendered: string[] = []
  for (const seq of checkpoint.summaryEvent.data.shadowedSeqs) {
    const event = session.eventAt(seq)
    if (!event) continue
    const message = session.deriveEventMessage(event)
    if (!message) continue
    rendered.push(renderMessage(message))
  }
  return rendered
}
