---
description: "声明式任务面板模型、纯 Session 投影与提交协调服务，供嵌入或检查任务面板的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-task-surface

[English](README.md) | 中文

## 概述

dsh-task-surface 为交互式任务面板提供声明式数据模型、边界校验、纯 Session 投影单元与宿主服务。任务面板允许 agent 向用户呈现结构化表单并等待输入或关闭。本包导出用于实时和回放视图的 taskSurface 投影单元，以及用于管理活跃面板和处理用户提交的 TaskSurfaceService。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

任务面板在 agent 执行期间协调人工输入。宿主应用挂载此包以校验面板声明、将活跃任务面板状态投影到客户端会话，并管理提交流程生命周期。

### 服务 API

| 成员 | 行为 |
|---|---|
| `getActive(session)` | 返回会话当前活跃的任务面板及待处理认领状态。 |
| `submit(session, submission)` | 根据活跃面板模式校验字段值并记录 submitted 会话事件。 |
| `dismiss(session, dismissal)` | 关闭当前活跃任务面板并记录 dismissed 会话事件。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本包包含三个核心架构组件：

- **声明式模型与校验**：`TaskSurfaceModelV1` 定义单元格布局与字段模式，并通过边界检查（`DEFAULT_TASK_SURFACE_LIMITS`）实施强制约束。
- **纯 Session 投影**：`taskSurfaceProjectionDefinition` 将任务面板事件投影为活跃面板状态，供客户端订阅者使用。
- **宿主协调服务**：`TaskSurfaceServiceImpl` 跨轮次跟踪活跃面板与待处理提交，在收到用户消息或关闭事件时清理挂起的认领。

</details>

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 tool-task-surface Consumer 呈现活跃任务面板与提交提示词。

#### KV Cache 效应

无；任务面板服务注册与投影状态不会改变模型请求前缀。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 每个会话仅允许一个活跃任务面板；当已有活跃面板时展示第二块面板将被拒绝。
- 表单提交要求满足所有已声明字段的校验；不支持部分提交。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
