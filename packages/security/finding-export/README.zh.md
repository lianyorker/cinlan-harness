---
description: "用于 Security Research Finding 的确定性 JSON、Markdown 和 SARIF 导出器。"
kind: "package-library"
---

# @deepseek-ai/dsh-finding-export

[English](README.md) | 中文

## 概述

此库将类型化 Finding 快照转换为确定性的 JSON、Markdown 或 SARIF 2.1.0 字节，不读取证据内容，也不访问外部服务。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

使用完整 Finding 快照调用 `exportFindingsJson`、`exportFindingsMarkdown` 或 `exportFindingsSarif`。Finding 按严重性、状态和 id 排序；空报告使用 Unix epoch，使相同输入产生相同字节。授权、附件持久化和下载呈现由 Consumer 负责。

<a id="model-experience"></a>
## 模型体验

### 导出结果

#### 模型看到的内容

此库不注册模型工具或 prompt。Consumer 可以在完成授权校验后暴露 `exportFindingsJson` 或其他导出器生成的字节。

#### Token 影响

导出器不增加 token；展示给模型的报告摘要由调用方 Consumer 负责。

#### KV Cache 影响

导出报告不会改变模型缓存前缀。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 导出内容包含 Finding 元数据和 Artifact 引用，不包含 Artifact 字节或凭证。
- 调用方必须在导出前执行评估范围校验，并选择适当的报告保留策略。

不发布 runtime invariant companion，因为这些纯导出器不保留状态；报告授权和持久化由调用方负责。

<a id="dev-note"></a>
### 开发备注

扩展导出 schema 时保持排序和时间戳规则不变，并同步更新导出器测试与报告 Consumer。
