/**
 * Storage schema for the knowledge base: the KV unit descriptor and the
 * record shapes stored in its tables. Documents hold the indexed source
 * files; chunks hold the paragraph-level slices the FTS index serves.
 * @module @cinlan/knowledge-base/schema
 */

import type { KvUnitDescriptor } from '@deepseek-ai/dsh-storage'

/**
 * The knowledge unit lives on the storage hub's sqlite backend with the
 * same capability seam as coordination-sqlite: the service talks to the
 * KvFacet contract, so tests may substitute any backend.
 */
export const KNOWLEDGE_UNIT: KvUnitDescriptor = {
  name: 'knowledge',
  version: 1,
  tables: ['documents', 'chunks'],
  hasGlobal: false,
  layout: 'per-record',
} as const

/** Identity of one indexed source document. */
export type DocumentId = string

/**
 * One indexed source document. `hash` is the content digest used to skip
 * re-chunking unchanged files on re-ingest.
 */
export interface KnowledgeDocument {
  readonly docId: DocumentId
  /** Which source supplied this document (v1: the directory source's name). */
  readonly source: string
  /** Path as the source addressed it (relative to the source root). */
  readonly path: string
  /** Best-effort title: the first heading, else the file name. */
  readonly title: string
  /** Content digest of the raw text at index time. */
  readonly hash: string
  /** Wall-clock index time in epoch milliseconds. */
  readonly indexedAt: number
}

/**
 * One paragraph-level slice of a document. Chunk text feeds the FTS index;
 * `heading` is the nearest preceding heading path for display grouping.
 */
export interface KnowledgeChunk {
  readonly chunkId: string
  readonly docId: DocumentId
  /** Position of this chunk inside its document, 0-based. */
  readonly ordinal: number
  /** The slice text itself. */
  readonly text: string
  /** Nearest preceding heading chain, e.g. `安装 / 配置`. */
  readonly heading: string
}

/** One search hit as the remote API returns it. */
export interface KnowledgeHit {
  readonly docId: DocumentId
  readonly ordinal: number
  /** The chunk text (or a snippet window of it, per the query config). */
  readonly text: string
  readonly heading: string
  /** Document title at index time, denormalized for display. */
  readonly title: string
}

/** Record key of a document row. */
export function documentKey(docId: DocumentId): string {
  return `doc-${docId}`
}

/** Record key of a chunk row; chunk ids are globally unique. */
export function chunkKey(chunkId: string): string {
  return `chunk-${chunkId}`
}
