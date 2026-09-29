---
description: "面向模型的 show_task_surface 工具，基于 DeepSeek Harness 会话日志提供交互式人机协作任务面板。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-task-surface

[English](README.md) | 中文

## 概述

`dsh-tool-task-surface` 提供面向模型的 `show_task_surface` 工具，使 agent 能够在多步骤执行期间请求结构化的人工输入。调用时，该工具根据会话限制校验声明式面板模型，将面板定义记录到会话日志中，结束当前轮次以等待人工响应，并在轮次恢复时将完成的回答格式化为提示词上下文。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [深入探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

挂载此包以使 agent 具备 `show_task_surface` 工具。每当在采取进一步操作前需要结构化用户决策、审批或多字段表单时，agent 就会使用此工具。

### 何时选用

当 agent 需要通过类型化交互控件（如文本、选择或复选框）获取结构化输入而非非结构化自由对话往复时，请选择它。对于对话消息即可满足的非结构化开放式问题，请避免使用它。

### 工具行为

调用 `show_task_surface` 会校验面板规范，将声明追加到会话历史记录中，并结束模型轮次。执行将暂停，直到用户提交回答或关闭面板。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

工具实现协调模型执行与投影状态：

- **轮次屏障与结束**：工具调用 `exec.concludeTurn()` 将执行让渡给人类用户，同时保留会话上下文。
- **投影校验**：在展示面板之前，它检查 `ctx.sessionProjections.stateOf(session, 'taskSurface')` 以强制执行单一活跃面板不变式。
- **上下文生成**：用户提交后，回答会被格式化为 Markdown 提示词并注入到恢复的轮次上下文中。

</details>

-----

<a id="further-exploration"></a>
## 深入探索

- [任务面板组地图](../README.zh.md)——同级包与组架构。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-task-surface)——模型接收的 `show_task_surface` schema。
- [任务面板 Agent Note](../../../.agents/notes/implemented/feature/2026-08-04-task-surface.zh.md)——统一任务面板设计与决策依据。

-----

<a id="model-experience"></a>
## 模型体验

### 工具模式

#### 模型所见

模型看到生成的 [show_task_surface schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-task-surface)：一个包含 `title`、可选 `description`、`schemaVersion: 1` 以及指定字段组件和校验条件的 `cells` 数组的对象。

#### Token 效应

在工具可见的每次请求上产生固定的模式成本；当面板处于活跃状态及用户提交时，提示词 token 会增加。

#### KV Cache 效应

在会话 profile 中工具定义和可见性保持不变期间前缀稳定。

### 工具调用历史与结果

#### 模型所见

每次工具调用都在其参数中保留完整的面板定义。工具在提交时返回确认消息，结束轮次并等待用户输入。

#### Token 效应

面板定义保留在对话历史记录中，直到压缩摘要或修剪更早的轮次。

#### KV Cache 效应

仅追加；新的工具调用参数和提交提示词紧随前缀之后，不会使缓存的轮次前缀失效。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了该工具不适合的场景。它们是当前的包约束，而非任务积压。

- **每个会话单一活跃任务面板**——当已有活跃面板时展示第二块面板将被拒绝，直到活跃面板得到解决。
- **仅支持整块面板提交**——不支持部分回答或按字段流式更新；用户需一并提交所有必填字段。
- **客户端展示依赖投影支持**——交互式渲染依赖会话中挂载的 `dsh-session-projection`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
