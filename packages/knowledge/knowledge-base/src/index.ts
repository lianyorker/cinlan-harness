/**
 * Deterministic document knowledge base: ingest source documents into the
 * storage hub's `knowledge` KV unit (system of record) and mirror them into
 * a dedicated FTS5 index (derived, rebuildable). Search answers come from
 * the FTS index only; the KV unit holds the authoritative chunks so the
 * index can always be rebuilt by re-ingesting.
 * @module @cinlan/knowledge-base
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { KvUnit, StorageBackend } from '@deepseek-ai/dsh-storage'
import { KnowledgeBaseError } from './errors.ts'
import { chunkDocument, extractTitle } from './chunk.ts'
import {
  KNOWLEDGE_UNIT,
  chunkKey,
  documentKey,
} from './schema.ts'
import type { KnowledgeChunk, KnowledgeDocument, KnowledgeHit } from './schema.ts'
import { openKnowledgeDatabase, toMatchExpression, segmentCjk } from './search.ts'

export * from './errors.ts'
export * from './schema.ts'
export { chunkDocument, extractTitle } from './chunk.ts'
export { openKnowledgeDatabase, toMatchExpression, segmentCjk } from './search.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeBase: KnowledgeBaseService
  }
}

/** Ingest source configuration. v1 serves local directories only. */
export interface KnowledgeSourceConfig {
  /** Absolute directory root to index. */
  readonly root: string
  /** Glob-like suffix filter; v1 supports a simple extension allowlist. */
  readonly extensions?: readonly string[]
}

export interface Config {
  /** Storage backend serving the knowledge unit (default `sqlite`). */
  readonly backend?: string
  /** Unit name on that backend (default `knowledge`). */
  readonly unit?: string
  /** Dedicated FTS index file path (or `:memory:` in tests). */
  readonly indexPath: string
  /** SQLite journal mode for the index (default `wal`). */
  readonly journalMode?: 'wal' | 'delete' | 'truncate' | 'persist'
  /** Default search page size (default `20`). */
  readonly defaultLimit?: number
  /** Maximum search page size (default `100`). */
  readonly maxLimit?: number
}

/** Text extensions indexed by the directory source. */
const DEFAULT_EXTENSIONS = ['.md', '.markdown', '.txt'] as const

/** File name of the authority row inside the `documents` table. */
const AUTHORITY_KEY = 'doc-authority'

/** Row tracking which documents the FTS index currently mirrors. */
interface AuthorityRow {
  readonly indexedDocIds: readonly string[]
}

/**
 * The knowledge base service. Declares its KV unit on the storage hub,
 * mirrors documents and chunks into a dedicated FTS5 database, and answers
 * paragraph-level searches. One instance owns one index file.
 */
export class KnowledgeBaseService extends Service {
  static Config: z<Config> = z.object({
    backend: z.string().default('sqlite'),
    unit: z.string().default('knowledge'),
    indexPath: z.string().required(),
    journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
    defaultLimit: z.number().step(1).min(1).max(1000).default(20),
    maxLimit: z.number().step(1).min(1).max(1000).default(100),
  }) as z<Config>

  static inject = ['storage']

  private readonly backendName: string
  private readonly unitName: string
  private readonly journalMode: NonNullable<Config['journalMode']>
  private readonly defaultLimit: number
  private readonly maxLimit: number
  private unit: KvUnit | undefined
  private db: Awaited<ReturnType<typeof openKnowledgeDatabase>> | undefined
  private closed = false
  /** Serializes ingest/remove mutations; search reads stay lock-free. */
  private chain: Promise<unknown> = Promise.resolve()
  /** All documents known to the KV unit, keyed by docId. */
  private documents = new Map<string, KnowledgeDocument>()
  private chunks = new Map<string, KnowledgeChunk>()
  private readonly indexPath: string

  constructor(ctx: Context, config: Config) {
    super(ctx, 'knowledgeBase')
    this.backendName = config.backend ?? 'sqlite'
    this.unitName = config.unit ?? 'knowledge'
    this.journalMode = config.journalMode ?? 'wal'
    this.defaultLimit = config.defaultLimit ?? 20
    this.maxLimit = config.maxLimit ?? 100
    this.indexPath = config.indexPath
    ctx.effect(() => async () => { await this.close() }, 'knowledgeBase.dispose')
  }

  protected async [Service.init](): Promise<void> {
    const backend = this.ctx.storage.backend.get(this.backendName) as StorageBackend
    const facet = backend.kv
    if (facet === undefined) {
      throw new KnowledgeBaseError(`storage backend "${this.backendName}" does not serve the key-value facet`, 'INVALID_CONFIG')
    }
    this.unit = await facet.open({ ...KNOWLEDGE_UNIT, name: this.unitName })
    const snapshot = await this.unit.loadAll()
    const documentsTable = snapshot.tables.documents ?? {}
    const chunksTable = snapshot.tables.chunks ?? {}
    for (const value of Object.values(documentsTable)) {
      const document = value as KnowledgeDocument
      // The authority row rides the documents table; skip it here.
      if (document !== null && typeof document === 'object' && 'indexedDocIds' in document) continue
      this.documents.set(document.docId, document)
    }
    for (const value of Object.values(chunksTable)) {
      const chunk = value as KnowledgeChunk
      this.chunks.set(chunk.chunkId, chunk)
    }

    this.db = await openKnowledgeDatabase(this.indexPath, this.journalMode)
    const authority = documentsTable[AUTHORITY_KEY] as AuthorityRow | undefined
    await this.rebuildIndexFrom(authority?.indexedDocIds ?? [])
  }

  /**
   * Rebuild the FTS mirror to cover exactly `wanted`: drop rows whose doc is
   * gone from the unit or not listed, insert rows missing. Called on init and
   * whenever the unit and the index might have diverged (e.g. crash between
   * unit write and index write — the unit wins, the index reconciles).
   */
  private async rebuildIndexFrom(wanted: readonly string[]): Promise<void> {
    const db = this.requireDb()
    const wantedSet = new Set(wanted)
    const current = db.prepare('SELECT DISTINCT doc_id FROM chunks_fts').all() as Array<{ doc_id: string }>
    for (const { doc_id: docId } of current) {
      if (wantedSet.has(docId)) continue
      db.prepare('DELETE FROM chunks_fts WHERE doc_id = ?').run(docId)
    }
    const indexed = db.prepare('SELECT DISTINCT doc_id FROM chunks_fts').all() as Array<{ doc_id: string }>
    const indexedSet = new Set(indexed.map(row => row.doc_id))
    for (const docId of wanted) {
      if (indexedSet.has(docId)) continue
      const chunks = [...this.chunks.values()].filter(chunk => chunk.docId === docId)
      const document = this.documents.get(docId)
      for (const chunk of chunks) this.insertChunkRow(db, chunk, document?.title ?? '')
    }
    await this.writeAuthority(wanted)
  }

  private insertChunkRow(
    db: NonNullable<KnowledgeBaseService['db']>,
    chunk: KnowledgeChunk,
    title: string,
  ): void {
    db.prepare(
      'INSERT INTO chunks_fts (text, chunk_id, doc_id, ordinal, heading, title) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(segmentCjk(chunk.text), chunk.chunkId, chunk.docId, chunk.ordinal, chunk.heading, title)
  }

  private async writeAuthority(wanted: readonly string[]): Promise<void> {
    const authority: AuthorityRow = { indexedDocIds: [...wanted] }
    await this.requireUnit().putRecord('documents', AUTHORITY_KEY, authority)
  }

  private requireUnit(): KvUnit {
    if (this.unit === undefined) throw new KnowledgeBaseError('knowledge base is closed', 'CLOSED')
    return this.unit
  }

  private requireDb(): NonNullable<KnowledgeBaseService['db']> {
    if (this.db === undefined) throw new KnowledgeBaseError('knowledge base is closed', 'CLOSED')
    return this.db
  }

  private assertOpen(): void {
    if (this.closed) throw new KnowledgeBaseError('knowledge base is closed', 'CLOSED')
  }

  /**
   * Ingest one local directory: read every allowed text file under `root`
   * (recursive), skip unchanged documents by hash, replace changed ones
   * wholesale. The KV unit commit happens first, the FTS mirror follows —
   * a crash in between reconciles on the next init.
   * @param source Source configuration naming the directory root.
   * @returns ingest summary: counts of added, updated, removed and unchanged documents.
   */
  async ingest(source: KnowledgeSourceConfig): Promise<{
    added: number
    updated: number
    removed: number
    unchanged: number
  }> {
    this.assertOpen()
    const extensions = source.extensions ?? DEFAULT_EXTENSIONS
    const files = await collectFiles(source.root, extensions)
    const seen = new Map<string, string>() // path → hash
    let added = 0
    let updated = 0
    let unchanged = 0

    for (const [absolute, text] of files) {
      const path = relative(source.root, absolute).replaceAll('\\', '/')
      const hash = createHash('sha256').update(text).digest('hex')
      seen.set(path, hash)
      const docId = docIdFor(source.root, path)
      const existing = this.documents.get(docId)
      if (existing !== undefined && existing.hash === hash) {
        unchanged += 1
        continue
      }
      const title = extractTitle(text, path)
      const document: KnowledgeDocument = {
        docId,
        source: source.root,
        path,
        title,
        hash,
        indexedAt: Date.now(),
      }
      const chunks = chunkDocument(docId, text)
      // Remove old chunks of this doc (hash changed ⇒ chunking may differ).
      const staleChunkIds = [...this.chunks.values()]
        .filter(chunk => chunk.docId === docId)
        .map(chunk => chunk.chunkId)
      await this.requireUnit().deleteRecords('chunks', staleChunkIds.map(chunkKey))
      for (const chunk of chunks) {
        await this.requireUnit().putRecord('chunks', chunkKey(chunk.chunkId), chunk)
        this.chunks.set(chunk.chunkId, chunk)
      }
      await this.requireUnit().putRecord('documents', documentKey(docId), document)
      this.documents.set(docId, document)
      if (existing === undefined) added += 1
      else updated += 1
    }

    // Documents whose file disappeared since the last ingest.
    const stale = [...this.documents.values()]
      .filter(document => !seen.has(document.path))
      .map(document => document.docId)
    for (const docId of stale) await this.removeDocumentRecords(docId)

    // Mirror the new state into the FTS index inside the same mutation.
    const wanted = [...this.documents.keys()]
    const db = this.requireDb()
    db.exec('DELETE FROM chunks_fts')
    for (const docId of wanted) {
      const document = this.documents.get(docId)
      if (document === undefined) throw new Error('knowledge document missing: ' + String(docId))
      for (const chunk of [...this.chunks.values()].filter(entry => entry.docId === docId)) {
        this.insertChunkRow(db, chunk, document.title)
      }
    }
    await this.writeAuthority(wanted)
    return { added, updated, removed: stale.length, unchanged }
  }

  private async removeDocumentRecords(docId: string): Promise<void> {
    const staleChunkIds = [...this.chunks.values()]
      .filter(chunk => chunk.docId === docId)
      .map(chunk => chunk.chunkId)
    await this.requireUnit().deleteRecords('chunks', staleChunkIds.map(chunkKey))
    for (const chunkId of staleChunkIds) this.chunks.delete(chunkId)
    await this.requireUnit().deleteRecord('documents', documentKey(docId))
    this.documents.delete(docId)
  }

  /**
   * Remove one document and its chunks from the unit and the index.
   * @param docId Document identity returned by earlier ingests or lists.
   * @throws `NOT_FOUND` when the document is unknown.
   */
  async removeDocument(docId: string): Promise<void> {
    this.assertOpen()
    if (!this.documents.has(docId)) {
      throw new KnowledgeBaseError(`unknown document "${docId}"`, 'NOT_FOUND')
    }
    await this.removeDocumentRecords(docId)
    const db = this.requireDb()
    db.prepare('DELETE FROM chunks_fts WHERE doc_id = ?').run(docId)
    await this.writeAuthority([...this.documents.keys()])
  }

  /**
   * Paragraph-level search across the indexed corpus.
   * @param query Query text; empty queries answer an empty page.
   * @param options Page size override.
   * @returns hits ranked by FTS5 relevance (bm25), each with snippet context.
   */
  search(query: string, options: { limit?: number } = {}): KnowledgeHit[] {
    this.assertOpen()
    const limit = Math.min(options.limit ?? this.defaultLimit, this.maxLimit)
    if (limit < 1) throw new KnowledgeBaseError('limit must be at least 1', 'INVALID_QUERY')
    const expression = toMatchExpression(query)
    if (expression === undefined) return []
    const db = this.requireDb()
    const rows = db.prepare(`
      SELECT chunk_id, doc_id, ordinal, heading, title,
             snippet(chunks_fts, 0, '…', '…', '…', 24) AS marked
      FROM chunks_fts
      WHERE chunks_fts MATCH ?
      ORDER BY bm25(chunks_fts)
      LIMIT ?
    `).all(expression, limit) as Array<{
      chunk_id: string
      doc_id: string
      ordinal: number
      heading: string
      title: string
      marked: string
    }>
    return rows.map(row => ({
      docId: row.doc_id,
      ordinal: Number(row.ordinal),
      text: row.marked,
      heading: row.heading,
      title: row.title,
    }))
  }

  /**
   * List every indexed document with its metadata.
   * @returns documents sorted by source path.
   */
  listDocuments(): KnowledgeDocument[] {
    this.assertOpen()
    return [...this.documents.values()].sort((a, b) => a.path.localeCompare(b.path))
  }

  /** Release the index handle; the KV unit closes with its backend. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.chain.catch(() => {})
    this.db?.close()
    this.db = undefined
  }
}

/**
 * Walk a directory recursively and read every allowed text file.
 * @param root Absolute directory root.
 * @param extensions Allowed lowercase extensions including the dot.
 * @returns absolute-path → text pairs in deterministic order.
 */
async function collectFiles(
  root: string,
  extensions: readonly string[],
): Promise<Array<[string, string]>> {
  const { readdir } = await import('node:fs/promises')
  const results: Array<[string, string]> = []
  const walk = async (dir: string): Promise<void> => {
    const dirents = await readdir(dir, { withFileTypes: true })
    for (const dirent of dirents.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = join(dir, dirent.name)
      if (dirent.isDirectory()) {
        await walk(absolute)
        continue
      }
      if (!extensions.some(extension => dirent.name.toLowerCase().endsWith(extension))) continue
      const text = await readFile(absolute, 'utf8')
      results.push([absolute, text])
    }
  }
  await walk(root)
  return results
}

/** Deterministic document identity from the source root and relative path. */
function docIdFor(root: string, path: string): string {
  const hash = createHash('sha256').update(`${root}\u0000${path}`).digest('hex').slice(0, 16)
  return `d${hash}`
}

export default KnowledgeBaseService
