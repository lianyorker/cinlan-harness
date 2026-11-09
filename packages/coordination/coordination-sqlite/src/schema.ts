/**
 * Durable journal declaration for the SQLite coordination provider.
 *
 * The journal is one per-record KV unit: every committed coordination event
 * becomes one record keyed by its zero-padded sequence number, so replay
 * order is the key order and a corrupted or tampered record fails loudly at
 * startup instead of silently skipping.
 * @module
 */
import type { KvUnitDescriptor } from '@deepseek-ai/dsh-storage'
import type { CoordinationEvent } from '@cinlan/coordination'

/** The KV unit the coordination journal records live in. */
export const JOURNAL_UNIT: KvUnitDescriptor = {
  name: 'coordination',
  version: 1,
  layout: 'per-record',
  tables: ['journal'],
  hasGlobal: false,
}

/** One durable journal entry: the envelope wraps a contract event with replay bookkeeping. */
export interface JournalEntry {
  /** Monotonic sequence starting at 1; the record key is the zero-padded decimal form. */
  readonly seq: number
  /** The committed contract event; replay folds entries in `seq` order. */
  readonly event: CoordinationEvent
  /** Commit time in epoch milliseconds. */
  readonly at: number
  /** Opaque immutable identity of the journal submission (idempotency hook for future re-dispatch tooling). */
  readonly submissionId: string
  /** SHA-256 digest of the canonical JSON form of `event` (tamper-evidence hook, not a guarantee). */
  readonly resultDigest: string
}

/** Zero-pad a sequence number into a per-record-safe journal key. */
export function journalKey(seq: number): string {
  return seq.toString().padStart(12, '0')
}
