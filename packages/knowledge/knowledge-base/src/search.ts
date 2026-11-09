/**
 * The knowledge search database: a dedicated derived SQLite index (FTS5)
 * opened directly with node:sqlite, the same approach session-query-sqlite
 * takes. This is a derived index, not a system of record — the authoritative
 * documents and chunks live in the storage hub's knowledge unit, and this
 * index can be rebuilt from them at any time by re-ingesting.
 * @module @cinlan/knowledge-base/search
 */

import { mkdir, open as openFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { KnowledgeBaseError } from './errors.ts'

/** SQLite application id stamped on a recognized knowledge index file. */
export const KNOWLEDGE_SQLITE_APPLICATION_ID = 0x4b_4e_4c_42 // "KNLB"

/** Schema version; a mismatching older index is wiped and rebuilt. */
export const KNOWLEDGE_SQLITE_SCHEMA_VERSION = 1

type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

const JOURNAL_MODES: ReadonlySet<string> = new Set(['wal', 'delete', 'truncate', 'persist'])

/**
 * Create the database file if missing, with owner-only permissions, before
 * node:sqlite opens it (it does not apply modes on create).
 */
async function createDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await openFile(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

/**
 * Open (or create) the knowledge search index and ensure its schema.
 * @param path - dedicated index file path or `:memory:` (tests).
 * @param journalMode - SQLite journal mode for the connection.
 * @returns the open database handle.
 * @throws when the file belongs to another application or is unrecognizable.
 */
export async function openKnowledgeDatabase(path: string, journalMode: JournalMode): Promise<DatabaseSync> {
  if (!JOURNAL_MODES.has(journalMode)) {
    throw new KnowledgeBaseError(`unknown journal mode "${journalMode}"`, 'INVALID_CONFIG')
  }
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') {
    await mkdir(dirname(actual), { recursive: true, mode: 0o700 })
    await createDatabaseFile(actual)
  }
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(actual)
  try {
    // journalMode is a validated closed union, not caller-controlled SQL.
    db.exec(`PRAGMA journal_mode = ${journalMode.toUpperCase()}`)
    const { application_id: applicationId } = db.prepare('PRAGMA application_id').get() as { application_id: number }
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    if (applicationId !== 0 && applicationId !== KNOWLEDGE_SQLITE_APPLICATION_ID) {
      throw new KnowledgeBaseError(`knowledge index at "${actual}" belongs to another application`, 'INDEX_FOREIGN')
    }
    if (applicationId === KNOWLEDGE_SQLITE_APPLICATION_ID && version !== KNOWLEDGE_SQLITE_SCHEMA_VERSION) {
      // Schema drift: this index is derived data, so wipe and rebuild is the
      // honest recovery rather than trying to migrate searchable text.
      db.exec('DROP TABLE IF EXISTS chunks_fts')
      db.exec('DROP TABLE IF EXISTS documents_meta')
      db.exec('PRAGMA application_id = 0')
    }
    ensureSchema(db)
    db.exec(`PRAGMA application_id = ${KNOWLEDGE_SQLITE_APPLICATION_ID}`)
    db.exec(`PRAGMA user_version = ${KNOWLEDGE_SQLITE_SCHEMA_VERSION}`)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents_meta (
      doc_id    TEXT PRIMARY KEY,
      source    TEXT NOT NULL,
      path      TEXT NOT NULL,
      title     TEXT NOT NULL,
      hash      TEXT NOT NULL,
      indexed_at INTEGER NOT NULL
    ) STRICT
  `)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      text,
      chunk_id UNINDEXED,
      doc_id UNINDEXED,
      ordinal UNINDEXED,
      heading UNINDEXED,
      title UNINDEXED,
      tokenize = 'unicode61'
    )
  `)
}

/**
 * Insert zero-width breaks inside Han runs so unicode61 indexes each
 * character: unicode61 keeps a whole CJK run as one token, which kills
 * substring recall. U+200B is a non-alphanumeric separator to the tokenizer
 * but invisible on display, so snippets stay readable.
 * @param text Chunk text as read from the source.
 * @returns text with zero-width separators inside Han runs.
 */
export function segmentCjk(text: string): string {
  return text.replace(/(\p{Script=Han})(?=\p{Script=Han})/gu, '$1\u200b')
}

/**
 * Translate a user query into an FTS5 MATCH expression. Quoted strings are
 * preserved verbatim (FTS5 operators honored as written); bare tokens are
 * split into ASCII-word and Han runs — a Han run becomes a per-character
 * phrase (`"网 关"`) matching the zero-width-segmented index text.
 * @param query Raw user query.
 * @returns the MATCH expression, or undefined when the query carries no terms.
 */
export function toMatchExpression(query: string): string | undefined {
  const tokens: string[] = []
  for (const match of query.matchAll(/"([^"]*)"|(\S+)/g)) {
    const quoted = match[1]
    const bare = match[2]
    if (quoted !== undefined) {
      tokens.push(`"${quoted.replaceAll('"', '""')}"`)
      continue
    }
    if (bare === undefined) continue
    if (/^(AND|OR|NOT)$/.test(bare)) {
      tokens.push(bare)
      continue
    }
    const runs = bare.match(/[A-Za-z0-9_]+|[\p{Script=Han}]+/gu) ?? []
    if (runs.length === 0) continue
    // FTS5 query syntax has no parentheses; consecutive terms are implicit AND.
    const rendered = runs
      .map(run => /\p{Script=Han}/u.test(run) ? `"${[...run].join(' ')}"` : `"${run}"`)
      .join(' ')
    tokens.push(rendered)
  }
  return tokens.length > 0 ? tokens.join(' ') : undefined
}
