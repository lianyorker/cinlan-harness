# @cinlan/tool-knowledge-search

Model-facing tools over the knowledge base: `knowledge_search` answers free-text queries against indexed documents, `knowledge_list_documents` lists what is indexed.

English | [中文](README.zh.md)

## Use this package

```yml
- id: tool-knowledge-search
  name: '@cinlan/tool-knowledge-search'
  config:
    maxLimit: 20
```

| Tool | Behavior |
| --- | --- |
| `knowledge_search` | Search indexed documents; Chinese and English queries both work; hits carry heading context and are ordered by relevance. |
| `knowledge_list_documents` | Every indexed document with path, title, and index time. |

## Config

| Field | Default | Behavior |
| --- | --- | --- |
| `maxLimit` | `20` | Cap applied to every `knowledge_search` call's `limit`; validated at plugin apply time, before `ctx.tools` is touched. |

The tools read `ctx.knowledgeBase` from [`@cinlan/knowledge-base`](../../knowledge/knowledge-base/README.md); mount that service first.

## Known Limitations and Deferred Work

- `knowledge_search` is keyword (FTS5) only; no semantic/vector path and no reranking yet.
- `knowledge_list_documents` returns document metadata without chunk previews.
