---
description: "无法读取的历史图片附件的持久隔离与经校验恢复。"
kind: "package-reference"
---

# @deepseek-ai/dsh-attachment-quarantine

[English](README.md) | 中文

## 概述

隔离无法读取的历史图片附件，使会话在对象丢失或校验失败后仍可继续使用。本插件在模型分发前将缺失或损坏的图片替换为确定性文本占位，派生请求跳过读取这些对象。经校验的恢复操作在读取校验通过后恢复原始引用。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [深入探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发笔记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在包含图片附件的持久会话组合中挂载此插件。已发布的 `dsh` base 配置默认挂载此插件。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-attachment-quarantine'
```

### 可观察行为

当图片不可读时，会话追加 `attachment/quarantine` 事件，记录其附件标识与失败类别（`not_found`、`corrupt` 或 `read_failed`）。后续模型请求派生确定性文本占位，而不是使会话失败。显式恢复在 `readImage()` 验证完整性后追加 `attachment/recovered`，恢复正常图片投影。

### 失败与恢复

`ATTACHMENT_NOT_FOUND` 与 `ATTACHMENT_CORRUPT` 失败会立即隔离对象。`ATTACHMENT_READ_FAILED` 错误会在服从取消信号的前提下重试一次；若仍失败，追加标记为可重试的隔离事件。显式恢复在清除隔离前校验摘要与元数据；缺失或损坏的字节绝不会被自动覆盖。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

本包声明 `attachment/quarantine` 与 `attachment/recovered` 事件，并提供从 `./projection` 导出的浏览器安全消息投影。它在 `ctx.sessions` 上注册这两个投影。原始历史事件在仅追加日志中保持不变；只有投影消息将已隔离的图片块替换为文本占位。

在模型请求组装期间，无法读取的引用会在提供方分发前被检测并隔离，使当前轮次可以重新投影并继续，而不会成为终止性的模型请求失败。后续轮次直接从历史派生占位并跳过磁盘读取。

恢复操作会调用 `AttachmentStore.readImage()` 确保完整的字节与元数据完整性，然后再追加 `attachment/recovered`。

</details>

-----

<a id="further-exploration"></a>
## 深入探索

- [附件子系统参考](../../../docs/subsystems/attachment.zh.md) — 服务契约与持久引用结构。
- [会话表层参考](../../../docs/subsystems/session.zh.md) — 消息投影与表层折叠生命周期。

-----

<a id="model-experience"></a>
## 模型体验

模型在无法读取的图片位置接收到稳定的文本占位，包含可用时的显示名称、附件 ID 前缀与失败类别。这向模型传达该图片已附加但暂时不可读。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

在活跃会话之外执行的辅助模型请求无法记录持久隔离状态；这类请求在读取错误时直接报错。

-----

<a id="dev-note"></a>
## 开发笔记

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
