# @cinlan/knowledge-base

基于 SQLite 的文档知识库：确定性摄取本地文档树（Markdown 与纯文本优先）、段落级切片、FTS5 全文检索（支持中日韩文本）。

[English](README.md) | 中文

## 用这个包

```ts
import KnowledgeBaseService from '@cinlan/knowledge-base'

ctx.plugin(KnowledgeBaseService, { indexPath: ':memory:' })
await ctx.knowledgeBase.ingest({ root: './docs' })
const hits = ctx.knowledgeBase.search('重启 服务', { limit: 5 })
```

| API | 行为 |
| --- | --- |
| `ingest(source)` | 走源树、解析受支持文件、跳过 hash 未变的文档，其余重新切片重建索引。 |
| `search(query, options)` | 段落级命中（`docId`、`ordinal`、`text`、`heading`、`title`），按 FTS5 相关度排序。 |
| `listDocuments()` | 全部已索引文档，带路径、标题、来源、索引时间。 |
| `removeDocument(docId)` | 删除文档及其切片，含 FTS 镜像。 |

## 存储

专用 KvUnit（`knowledge`，`per-record` 布局）落在 storage-hub 的 SQLite 后端上，持有 `documents` 与 `chunks` 行；FTS5 虚表是派生索引，init 时对账——KV 行是系统记录，索引可由其重建。文档身份是 `d` + `sha256(root\0path)` 的前 16 个 hex；authority 行记录 FTS 镜像范围。application id 或 schema 版本不匹配的数据库会被丢弃重建。

## 中日韩检索

进 FTS5 前先分词：汉字 run 之间插零宽空格，让 `unicode61` 逐字索引；查询侧把汉字 run 转成逐字短语。多 run 查询按隐式 AND 组合。长中文短语的召回弱于向量检索——v1 如实标注 defined-not-enforced；向量后端是后续增强。

## 工具化

`@cinlan/tool-knowledge-search` 把 `knowledge_search` 与 `knowledge_list_documents` 经 `ctx.knowledgeBase` 暴露给模型会话。

## 已知局限与延后工作

- FTS5 关键词对长中文短语的召回弱于向量检索（逐字索引）；向量后端是延后项，不是放弃项。
- 尚无增量重灌：内容有变化的新灌入会整体替换该文档既有切片。
