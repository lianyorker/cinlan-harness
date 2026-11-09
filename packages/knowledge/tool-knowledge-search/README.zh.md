# @cinlan/tool-knowledge-search

知识库的模型侧工具：`knowledge_search` 用自由文本查已索引文档，`knowledge_list_documents` 列出已索引内容。

[English](README.md) | 中文

## 用这个包

```yml
- id: tool-knowledge-search
  name: '@cinlan/tool-knowledge-search'
  config:
    maxLimit: 20
```

| 工具 | 行为 |
| --- | --- |
| `knowledge_search` | 检索已索引文档；中英文查询都可用；命中带标题上下文，按相关度排序。 |
| `knowledge_list_documents` | 全部已索引文档，带路径、标题、索引时间。 |

## 配置

| 字段 | 默认 | 行为 |
| --- | --- | --- |
| `maxLimit` | `20` | 每次 `knowledge_search` 调用 `limit` 的上限；在插件 apply 时校验，先于触碰 `ctx.tools`。 |

工具从 [`@cinlan/knowledge-base`](../../knowledge/knowledge-base/README.zh.md) 读取 `ctx.knowledgeBase`；先挂载该服务。

## 已知局限与延后工作

- `knowledge_search` 只有关键词（FTS5）路径；尚无语义/向量检索与重排。
- `knowledge_list_documents` 只返回文档元数据，不带切片预览。
