/**
 * Compaction checkpoint source: the correlated constructor and type
 * every backend uses for its replacement user message, plus the predicate that
 * recognizes persisted checkpoints.
 *
 * The seam itself lives in `@deepseek-ai/dsh-compaction`, which re-exports these
 * contracts; this module is a pure type/value/predicate outlet (no cordis
 * imports, no module augmentation) so client and wire programs can name the
 * checkpoint source without loading the host plugin's Context merges — the
 * `dsh-commands/brand` shape.
 *
 * @module @deepseek-ai/dsh-compaction/checkpoint
 */

import type { MessageSource } from '@deepseek-ai/dsh-llm/message'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { CompactionId } from './brand.ts'

const COMPACT_CHECKPOINT_MARKER = Object.freeze({ kind: 'compact-checkpoint' } as const)

/** Message source carried by a concrete compaction checkpoint. */
export type CompactionCheckpointSource = typeof COMPACT_CHECKPOINT_MARKER & {
  readonly compactionId: CompactionId
  readonly sourceCommandId?: CommandId
}

/**
 * Create a checkpoint source correlated with one compaction transaction.
 * @param compactionId - owning compaction identity.
 * @param sourceCommandId - initiating manual command, when present.
 * @returns immutable checkpoint source.
 */
export function compactCheckpointSource(
  compactionId: CompactionId,
  sourceCommandId?: CommandId,
): CompactionCheckpointSource {
  return Object.freeze({
    ...COMPACT_CHECKPOINT_MARKER,
    compactionId,
    ...sourceCommandId === undefined ? {} : { sourceCommandId },
  })
}

/**
 * Test whether a persisted message source identifies a compaction checkpoint.
 * @param source - source restored from a surface user message.
 * @returns whether the source carries the backend-independent checkpoint marker.
 */
export function isCompactCheckpointSource(source: MessageSource): source is CompactionCheckpointSource {
  return source.kind === 'compact-checkpoint'
}

/**
 * Format the standard code-composed footer pointer for a compaction checkpoint.
 * @param summarySeq - seq of the compaction/summary event.
 * @param start - first shadowed surface sequence.
 * @param end - last shadowed surface sequence.
 * @returns deterministic footer string.
 */
export function formatCheckpointFooter(
  summarySeq: number,
  start: number,
  end: number,
): string {
  return `[checkpoint c${summarySeq}: shadows conversation span #${start}–#${end}; originals retrievable via history_read]`
}

/** Pattern matching standard checkpoint footer pointers. */
export const CHECKPOINT_FOOTER_RE =
  /\[checkpoint c(\d+): shadows conversation span #(\d+)–#(\d+); originals retrievable via history_read\]/
