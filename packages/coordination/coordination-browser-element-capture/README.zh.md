---
description: "用于持久化已核验 Browser 元素图像的 Coordination executor。"
kind: "package-reference"
---

# @deepseek-ai/dsh-coordination-browser-element-capture

[English](README.md) | 中文

## 概述

这个 Host 插件在 `ctx.coordination` 上注册 `browser-element-capture` executor。它接收 JSON-safe Browser target，调用选定的 Browser Provider，并通过 `ctx.attachments` 持久化已核验裁剪；Playwright handle、DOM node、overlay state 和图像字节都不会进入保留的 Coordination output。

## 目录

- [Task contract](#task-contract)
- [生命周期](#lifecycle)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="task-contract"></a>
## Task contract

| 部分 | 字段 |
|---|---|
| Executor kind | `browser-element-capture` |
| Observation input | `page_id`、`kind: observation`、`observation_id`、`element_id`、`format` |
| Selection input | `page_id`、`kind: selection`、`selection_id`、`format` |
| 成功 output | `attachmentId`、`mediaType`、`bytes`、`width`、`height`、可选 `name` |

Input 必须是 JSON-safe 值，并且只包含其 discriminant 对应的精确字段。Executor 把 task `AbortSignal` 传给 Browser capture，在持久化前检查取消状态，把编码字节保存为 `browser-element.png` 或 `browser-element.jpg`，核验返回 attachment 的 media type，并且只保留 attachment metadata。

Browser、验证与 attachment failure 会产生 failed task。取消会产生 cancelled task，并且不会伪造成功 attachment result。

<a id="lifecycle"></a>
## 生命周期

Host 组合只加载一个 executor registration。该注册绑定到 plugin fiber，因此 disposal 或 HMR 会注销 kind；活动调用继续由配置的 Coordination service executor 生命周期负责。

<a id="model-experience"></a>
## 模型体验

### Consumer 渲染的 capture result

#### 模型看到的内容

本 executor 不贡献 prompt 或 tool definition。[`@deepseek-ai/dsh-tool-browser-element-capture`](../../browser/tool-browser-element-capture/README.zh.md) 根据保留的 attachment metadata 渲染成功的 `browser_capture_element` result。

#### Token 影响

本包不直接增加模型 token。Capture 成功时，Consumer 为 result text 和单张裁剪图像付费。

#### KV Cache 影响

Executor 注册与 task 调度不改变模型请求前缀；task-specific attachment metadata 只出现在 Consumer 渲染的后缀历史中。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

- Crash recovery、task retention 与 queue retry 遵循配置的 Coordination Provider；本 executor 不增加独立持久化层。
- 选定的 Browser Provider 必须实现 element-capture extension。
- Attachment persistence 在结果不确定的 storage failure 后没有 task-level retry。

<a id="dev-note"></a>
### 开发备注

本包不发布 runtime invariant companion，因为它只贡献一个 effect-owned executor 且不保留独立状态；Coordination service 负责 registration lookup 与 terminal task state。
