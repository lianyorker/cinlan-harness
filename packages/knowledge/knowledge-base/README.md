# @cinlan/knowledge-base

Document knowledge base over SQLite: deterministic ingest of local document trees (Markdown and plain text first), paragraph-level chunking, and FTS5 full-text search with CJK support.

English | [中文](README.zh.md)

## Use this package

```ts
import KnowledgeBaseService from '@cinlan/knowledge-base'

ctx.plugin(KnowledgeBaseService, { indexPath: ':memory:' })
await ctx.knowledgeBase.ingest({ root: './docs' })
const hits = ctx.knowledgeBase.search('重启 服务', { limit: 5 })
```

| API | Behavior |
| --- | --- |
| `ingest(source)` | Walk the source tree, parse supported files, skip documents whose hash is unchanged, rechunk and reindex the rest. |
| `search(query, options)` | Paragraph-level hits (`docId`, `ordinal`, `text`, `heading`, `title`), ordered by FTS5 relevance. |
| `listDocuments()` | Every indexed document with path, title, source, and index time. |
| `removeDocument(docId)` | Remove a document and its chunks, including the FTS mirror. |

## Storage

A dedicated KvUnit (`knowledge`, `per-record` layout) over the storage-hub SQLite backend holds `documents` and `chunks` rows; the FTS5 virtual table is a derived index that init reconciles — the KV rows are the system of record and the index can be rebuilt from them. A document identity is `d` + the first 16 hex of `sha256(root\0path)`; the authority row records the FTS mirror range. A database whose application id or schema version does not match is dropped and rebuilt.

## CJK search

Text is segmented before it reaches FTS5: Han runs are split with zero-width-space separators so `unicode61` indexes per-character; query terms map Han runs to per-character quoted phrases. Multi-run queries combine as implicit AND. Recall for long Chinese phrases is weaker than vector search — this is defined-not-enforced for v1; a vector backend is a later enhancement.

## Tooling

`@cinlan/tool-knowledge-search` exposes `knowledge_search` and `knowledge_list_documents` to model sessions over `ctx.knowledgeBase`.

## Known Limitations and Deferred Work

- FTS5 keyword recall for long Chinese phrases is weaker than vector search (per-character indexing); the vector backend is deferred, not dropped.
- No incremental re-ingest yet: an unchanged document re-ingested with new content replaces its chunks wholesale.
