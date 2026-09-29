---
description: "面向模型的 history_read 与 history_search 召回工具，用于访问已压缩的会话日志。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-recall

[English](README.md) | 中文

## 概述

`dsh-tool-recall` 提供了面向模型的 `history_read` 与 `history_search` 工具，允许 agent 检视被压缩检查点遮蔽的原始会话历史。当长对话被压缩时，早期的用户指令、代码片段、命令调用和工具结果均保存在持久化会话日志中；本插件为 agent 配备直接的读取与搜索访问能力，以便按需检索那些确切细节。

## 目录

- [使用此包](#use-this-package)
- [理解实现原理](#understand-the-implementation)
- [深入探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在 cordis 配置中将此插件与 `@deepseek-ai/dsh-tools` 以及 `@deepseek-ai/dsh-system-prompt` 一起挂载：

```yaml
- name: '@deepseek-ai/dsh-system-prompt'
- name: '@deepseek-ai/dsh-tools'
- name: '@deepseek-ai/dsh-tool-recall'
  config:
    readBudgetChars: 8000
    searchLimit: 25
```

### 注册的工具

| 工具 | 用途 | 关键参数 |
|---|---|---|
| `history_read` | 检索被特定压缩检查点遮蔽的原始消息完整转录文本，支持字符预算分页。 | `checkpoint`（字符串，必填）、`offset`（整数，可选） |
| `history_search` | 在所有被压缩的会话跨度中执行不区分大小写的字面扫描，搜索确切关键字、路径或错误。 | `query`（字符串，必填）、`checkpoint`（字符串，可选）、`limit`（整数，可选） |

### 配置项

| 选项 | 类型 | 默认值 | 描述 |
|---|---|---|---|
| `readBudgetChars` | `number` | `8000` | 生成接续游标前，每个 `history_read` 页面的软性字符预算。 |
| `searchLimit` | `number` | `25` | `history_search` 返回的匹配代码片段出现次数的默认上限。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现原理

<details>
<summary>实现细节——点击展开</summary>

该包将模型工具调用桥接至不可变的会话事件投影。

### 检查点解析与转录文本重构

检查点通过其摘要序列 ID 进行标识（例如对应序列号 42 处 `compaction/summary` 的 `c42`）。当 `history_read` 或 `history_search` 指向某个检查点时，插件通过 `session.surface.nodes` 或持久化的 `compaction/summary` 日志事件解析该检查点。

为了如实重构被遮蔽的转录文本，引擎会遍历 `shadowedRange.start` 与 `shadowedRange.end` 之间的持久化事件流。跳过非消息信封事件，而消息事件（`user/message`、`assistant/message`、`tool/result`、`system/message`）则带有清晰的发言者标签进行格式化。如果某个跨度本身遮蔽了更早的状态检查点，该状态检查点会被标记为 `[prior state checkpoint]`，以保持因果历史，同时避免循环解引用。

### 源码映射

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：cordis 插件定义、工具定义与系统提示词注册 |
| [`src/types.ts`](src/types.ts) | 类型定义与 Schemastery 配置模式 |
| [`src/errors.ts`](src/errors.ts) | 带有类型化诊断码的品牌化 `RecallError` |
| [`src/transcript.ts`](src/transcript.ts) | 检查点解析、消息重构与渲染逻辑 |

</details>

-----

<a id="further-exploration"></a>
## 深入探索

- [压缩 seam](../compaction/README.zh.md)——压缩与检查点架构。
- [工具运行时](../../core/tools/README.zh.md)——工具执行管线与展示。
- [可召回式压缩 Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-recallable-compaction.zh.md)——可召回式检查点的架构规范。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 Schema

#### 模型看到的内容

模型看到生成的 [`history_read` 与 `history_search` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-recall)：`history_read` 接受检查点标识符与可选的字符偏移量；`history_search` 接受字面量查询字符串、可选的检查点过滤项以及结果条数限制。

#### Token 影响

在注册召回工具的请求上具有固定的 schema 成本；schema 在会话生命周期内保持稳定。

#### KV Cache 影响

在工具定义未发生变化时跨轮次前缀稳定；读取结果仅在模型显式触发召回时追加至会话尾部。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **进程内线性扫描**——`history_search` 在内存中对持久化会话日志事件执行不区分大小写的字面行扫描。包含数万个被压缩事件的高度饱和会话不会使用持久化全文索引。
- **需要 agent 调用方**——两个工具均需要挂载了 `Session` 的活跃 agent 上下文；没有 agent 上下文的独立工具调用将失败并抛出 `NON_AGENT_CALLER`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

召回工具特意没有引入新的存储 sidecar 或外部向量数据库；它们直接从规范的不可变会话日志中读取。

</details>
