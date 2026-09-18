---
description: "面向模型的 Work Items 读取与持久化外部写入审批工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-work-items

[English](README.md) | 中文

## 概述

本包是 provider-neutral [`ctx.workItems`](../work-items/README.zh.md) capability 的 model-facing Consumer。它负责六个 tool definition、有界模型输入校验、稳定 system guidance、canonical result projection、timeout metadata、concurrency 声明和通用 render intent；它不导入具体 Provider，也不执行 HTTP、credential resolution、endpoint 选择、header 构造或 GraphQL 执行。

## 目录

- 概述
- 工具
- 审批协议
- 配置
- 模型体验
- 已知限制与后续工作
- 开发备注

## 工具

| 工具 | 参数 | 结果与副作用 |
|---|---|---|
| `work_items_list` | 可选 `source`、结构化 `scope`、`query`、`state`、`cursor` 和 `limit` | 有界的标准化 GitHub 或 Linear Work Items page；只读。 |
| `work_items_get` | Work Items 读取结果返回的 opaque `id` | 一个标准化 Work Item；只读。 |
| `work_items_prepare_write` | 一个 `create`、`comment`、`state` 或 `assign` mutation | 带有 `operationId` 的持久化不可变预览；不会联系 Provider 执行 mutation。 |
| `work_items_confirm_write` | 持久化预览中的精确 `operation_id` | 执行该预览或返回已有回执；不接受替换 mutation 字段。 |
| `work_items_cancel_write` | 持久化预览中的精确 `operation_id` | 在未联系 Provider 的情况下取消待执行预览。 |
| `work_items_list_writes` | 必需的 Provider `source` 和 `limit` | 有界的持久化预览与回执；不会发起 Provider mutation request。 |

## 审批协议

面向模型的写入永远分两步：prepare 持久化精确 mutation 和目标 revision，confirm 只接受持久化的 `operation_id`。Consumer 不允许 confirmation 调用替换已批准的 mutation。`running` 和 `unknown` 回执可能表示外部请求已经发出但本地不知道结果；system guidance 禁止自动重试，模型应先通过 Provider 或 Host UI 核实，再决定是否创建新的预览。

读取 scope 只允许结构化 GitHub `owner`/`repository` 或 Linear `team`/`project`。模型不能提交任意 URL、endpoint、header、token、credential reference 或 GraphQL text。Tool result 会重建标准化 item 与 receipt 字段，并省略 Provider writer 的内部 scope string，因此 credential 配置 metadata 不会进入 model context。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `timeoutMs` | `60000` | 附加到每个 Work Items tool call 的 cooperative timeout metadata。 |

未知键，以及非正数、非整数、不安全或超过 runtime timer 上限的 timeout 值，会在插件设置时失败。读取工具和写入历史读取声明 sibling concurrency safety；prepare、confirm 和 cancel 保持顺序，因为它们操作同一个持久化审批 ledger。

## 模型体验

### Work Items system prompt

#### 模型看到的内容

插件增加一个稳定 section，说明标准化读取、不可变 prepare/confirm/cancel 协议、精确 operation identity 以及不确定回执的处理方式。

##### Work Items guidance

```markdown
Use work_items_list or work_items_get for Work Items reads. External changes use two steps: call work_items_prepare_write to persist an immutable preview, inspect its operation_id and mutation, and call work_items_confirm_write with exactly that operation_id only after the requested approval. work_items_confirm_write and work_items_cancel_write never accept replacement mutation fields. A running or unknown result may have reached the provider; do not retry it automatically. Use work_items_list_writes or the provider UI to verify uncertain outcomes. Provider scope is deployment-configured; never invent an endpoint, header, token, or GraphQL text.
```

#### Token 影响

固定 guidance 在 Consumer 激活时增加稳定的 request-prefix 成本。

#### KV Cache 影响

只要 plugin scope 和 guidance text 不变，prompt prefix 就可以复用。加载、卸载或修改 Consumer 可能从第一个变化的 prompt token 起使复用失效。

### Work Items tool schemas

#### 模型看到的内容

Consumer 可见时，模型会收到六个 `work_items_*` definition，用于标准化读取、持久化预览审批、取消和回执历史。生成的 [tool schema catalog](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-work-items) 记录精确的参数 schema 与 description。

#### Token 影响

Consumer 可见时，六个固定 definition 增加稳定的 request-prefix 成本；mutation body 和读取 filter 增加取决于数据的 call token。

#### KV Cache 影响

Definition 与 visibility 不变时可以保留可复用 prefix。配置或 tool scope 变化会从第一个变化的 schema token 起使复用失效。

### Work Items tool results

#### 模型看到的内容

读取结果包含标准化 item 字段和有界分页。写入结果包含精确 mutation、operation identity、status、target summary、receipt 与安全 error code；内部 Provider scope 和 credential metadata 会被省略。`unknown` result 是需要核实的信号，不是重试指令。

#### Token 影响

item body、labels、assignees 和 write preview 取决于数据，并在 compaction 前保留在 session context 中。Pagination 和显式 limit 限制每次返回的 page 或 history read。

#### KV Cache 影响

Tool result 追加在可复用 request prefix 之后，不改变已缓存的 prompt 或 tool-definition token。

## 已知限制与后续工作

- 外部写入要求配置了 `allowWrites` 的 Provider 和持久化 `storageDomain`；本 Consumer 不会启用任何一项配置。
- 不确定或重启恢复的 `unknown` 回执永不自动重试；必须由 Provider 或 Host UI 先确认结果，再准备新的预览。
- Consumer 不提供 repository/team discovery、批量 mutation、删除、任意 Provider endpoint、调用方自选 header、credential value 或调用方编写的 GraphQL text。
- Provider-specific state name、assignment 规则、pagination 行为和 availability 仍由选定的 Work Items Provider 所有。

<a id="dev-note"></a>
### 开发备注

Consumer 只投影 model contract。Provider credential、transport、response normalization、durable ledger 语义以及 Host/UI presentation 保留在各自所属 package。

不发布运行时 invariant companion，因为 ToolRuntime 拥有日志 call/result 关系，WorkItemsRuntime 拥有 Provider registration 与 durable write state；本包不保留第二份 authority。
