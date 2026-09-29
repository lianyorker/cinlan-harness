---
description: "具有冻结索引存根、可变状态检查点与免密钥重放能力的可召回式会话上下文压缩引擎。"
kind: "package-reference"
---

# @deepseek-ai/dsh-compact-recallable

[English](README.md) | 中文

## 概述

本包为 deepseek-harness 提供可召回式上下文压缩引擎。它不再将全部历史压缩为单段有损摘要，而是把陈旧轮次划分为细粒度的冻结索引存根和一个结构化的工作记忆状态检查点。与 @deepseek-ai/dsh-tool-recall 配合使用时，模型可以按需检索过去轮次的完整原始消息文本而无需臆测，同时保持零数据丢失、免密钥重放以及严格的上下文窗口限制。

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

在提供 LLM、会话持久化与 Token 测量的 Cordis 组合中，将本包作为 dsh-compaction-basic 的升级替代方案挂载：

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-token-meter'
- name: '@deepseek-ai/dsh-compaction-compact-recallable'
  config:
    thresholdRatio: 0.8
    retainRatio: 0.16
    chunkTokens: 4000
    stubTokens: 200
- name: '@deepseek-ai/dsh-tool-recall'
- name: '@deepseek-ai/dsh-command-compact'
```

### 你将获得的功能

当已定价的 Token 数量超出设定的阈值时，自动可召回式压缩会在 agent/pre-step 阶段触发，将陈旧轮次切分为独立的索引分块与一个活跃状态检查点。它还负责在 agent/request-error 处处理上下文窗口溢出恢复，支持通过 compactNow 或 /compact 进行按需手动压缩，并与工具输出剪枝器无缝协同。

### 配置选项

| 选项 | 类型 | 默认值 | 描述 |
|---|---|---|---|
| thresholdRatio | number | 0.8 | 触发 pre-step 自动压缩的上下文窗口比例阈值。 |
| retainRatio | number | 0.16 | 近期尾部逐字保留的上下文窗口比例；与 retainTokens 互斥。 |
| retainTokens | number | undefined | 近期尾部逐字保留的显式 Token 预算；与 retainRatio 互斥。 |
| chunkTokens | number | 4000 | 每个冻结索引分块切片的目标 Token 大小。 |
| stubTokens | number | 200 | 用于膨胀计算的每个生成索引存根预估 Token 大小。 |
| summarizationProvider | string | undefined | 压缩摘要模型调用的提供方覆盖。 |
| summarizationModel | string | undefined | 压缩摘要模型调用的模型覆盖。 |
| maxTokens | number | 8192 | 摘要器响应允许的最大输出 Token 数。 |
| compactionRetries | number | 1 | 压缩通过后如果 Token 计数仍高于阈值的重试次数。 |
| maxOverflowRetries | number | 1 | 提供方上下文溢出时授权的最大连续重试次数。 |
| modelPolicies | array | [] | 按提供方和模型名称匹配的每模型策略覆盖。 |
| auto | boolean | true | 是否挂载自动 pre-step 与溢出压缩监听器。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现原理

<details>
<summary>实现细节——点击展开</summary>

可召回式压缩引擎实现了保持免密钥重放与可召回性的三阶段架构：

1. 分区：selectPartitionPlan 识别系统提示词，根据 retainRatio 或 retainTokens 保留近期逐字尾部，遵循工具调用配对平衡边界，并将中间的陈旧历史切分为冻结索引分块（约 chunkTokens）和尾随切片。
2. 并发摘要：summarizeChunk 独立处理每个分块，注入前序状态与关键字目录作为背景引导，同时 summarizeState 摘要活跃工作记忆。若分块仅包含召回工具调用和结果，则降级为零 LLM 确定性指针；若分块 LLM 失败，则降级为代码生成的后备存根。
3. 膨胀防护与顺序提交：在提交之前，引擎断言预估的新 Token 数必须严格低于被遮蔽的 Token 数。验证通过后，它为每个存根顺序提交 compaction/start、compaction/summary、user/message 表层替换以及 compaction/end 事件，随后提交可变状态检查点。
4. 后续压缩轮次与折叠：在随后的压缩轮次中，前一个可变状态检查点会被并入新的压缩范围并转化为索引分块，而所有早期的索引存根在表层原始位置保持不可变。

### 源码导图

| 文件 | 职责 |
|---|---|
| [src/index.ts](src/index.ts) | 引擎生命周期、Cordis 服务注册、自动监听器及顺序提交 |
| [src/types.ts](src/types.ts) | 公共配置、切片模型与结果接口定义 |
| [src/config.ts](src/config.ts) | 配置解析、校验规则与按模型策略解析 |
| [src/chunking.ts](src/chunking.ts) | 会话分区、工具边界平衡及索引检查点识别 |
| [src/summarizer.ts](src/summarizer.ts) | 并发 LLM 摘要、分层提示词与降级阶梯 |
| [src/prompts.ts](src/prompts.ts) | 索引存根与状态检查点摘要器的提示词模板 |

</details>

-----

<a id="further-exploration"></a>
## 深入探索

- [召回工具](../tool-recall/README.zh.md) — 面向模型的 history_read 与 history_search 工具。
- [压缩能力接缝](../compaction/README.zh.md) — 共享的压缩服务定义与类型。
- [可召回式压缩 Agent 架构备忘](../../../.agents/notes/implemented/feature/2026-07-06-recallable-compaction.zh.md) — 可召回式检查点的架构规范。

-----

<a id="model-experience"></a>
## 模型体验

### 对话历史

#### 模型看到的内容

在自动或手动压缩之后，陈旧的对话轮次会被替换为冻结的索引存根和可变的状态检查点。每个存根携带关键词锚点以及指向被遮蔽消息区段的确定性页脚，后随包含当前目标、决策、约束和后续步骤的状态检查点。

#### Token 影响

冻结存根将过往轮次压缩为约 100–200 个 token 的索引卡片，而可变状态检查点在配置的上限内保留工作记忆。未来的输入历史大幅缩减，为后续轮次留出充足空间。

#### KV Cache 影响

冻结索引存根在后续压缩轮次之间逐字节保持一致，从而在多轮压缩中保留前缀提示词缓存命中。仅重写的状态检查点和新增的对话轮次需要重新进行提示词求值。

### 辅助摘要器请求

#### 模型看到的内容

摘要模型接收分片切片或先前状态上下文并结合确定性提示词重放，生成带有关键词锚点的结构化索引存根或合并后的工作记忆更新。

#### Token 影响

摘要器请求在各个陈旧分片之间并发运行，受到 `chunkTokens` 和 `stubTokens` 配置上限的约束。

#### KV Cache 影响

并发分片调用之间的辅助请求共享通用前导与轮次起始状态前缀，可享受受支持提供方的缓存 token 读取费率。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 进程内 LLM 摘要：摘要在 harness 进程内并发执行。包含数十个分块的超大对话可能会达到提供方的并发限制。
- 不可分割的单条消息：单个超大消息（如超出分块 Token 数的巨型文件倾倒）无法被切分，将单独占据一个分块。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

可召回式压缩严格维护一项不变式：所有历史表层替换均作为规范的会话事件持久化记录，无需外部数据库即可实现确定性免密钥重放。

</details>
