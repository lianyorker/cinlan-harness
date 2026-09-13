---
description: "面向模型的 Coordination 工具，用于启动、检查、等待、取消任务图并发送任务消息。"
kind: "package-reference"
---

# dsh-tool-coordination

[English](README.md) | 中文

## 概述

向模型提供任务图生命周期操作，同时保留可替换的调度与执行方式。

## 使用本包

此 model-facing Consumer 通过 `ctx.tools` 暴露 task graph，同时把调度与执行保留在可独立替换的插件中。它注册六个工具：

| Tool | 行为 |
|---|---|
| `coordination_start` | 校验并启动后台 DAG。 |
| `coordination_add_task` | 向 live 且归当前调用方所有的 run 添加一个任务。 |
| `coordination_status` | 读取 owned run 及其任务，或读取一个 owned task。 |
| `coordination_wait` | 等待目标进入终态或有界 timeout 到期。 |
| `coordination_cancel` | 取消 run，或取消 task parent-subtree 以及因依赖取消而被传递阻塞的任务。 |
| `coordination_send_message` | 提交定向到 task 的消息，供已安装 Listener 处理。 |

任务包含 standalone `prompt`、可选稳定 `task_id`、依赖 id、可选取消父任务和可选 Executor kind。Consumer 使用 `{ prompt, parentAgentId }` 作为 provider-specific task input。配套的 [`dsh-coordination-subagent-executor`](../coordination-subagent-executor/README.zh.md) 接受该输入；其他配置的 Executor kind 也必须接受相同字段。

## 目录

- [Ownership and lifecycle](#ownership-and-lifecycle)
- [配置](#config)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="ownership-and-lifecycle"></a>
## Ownership and lifecycle

每次工具调用都要求 exact live calling Agent。Run 和 task 只对创建它们的 Session 可见；读取进程级 coordination service 之前，task lookup 会先经过 Consumer 的 ownership index。Agent disposal 会取消其未终结 run 并移除工具访问权。插件 disposal 采用相同行为，因此 HMR 不会遗留无法收集的工作。Provider 发出 `run/evicted` 时，Consumer 会立即删除对应 ownership 和 task index。

`coordination_wait` 会订阅 coordination event，并在订阅后重新检查状态，因此不会遗漏初次读取与 Listener 安装之间发生的结算。Timeout 会返回当前状态和 `timedOut: true`；调用方取消只会拒绝本次等待，不会取消 run。

`coordination_send_message` 会提交消息，并把当前调用方标记为 `sender`。Service Definition 会通知 message Listener，但提交记录不代表 remote 或 one-shot Executor 支持 live steering；该行为归 delivery adapter 所有。

Task input 永远不会返回给模型。Lossless JSON task output 会正常返回；其他 Executor 产生的非 JSON 输出会以 `outputOmitted: true` 省略，而不会导致状态读取失败。

`CoordinationError` 继承 Harness 的 machine-routable error 基类。因此 Provider failure 会在工具结果的 `error.info` 中保留 `{ name: 'CoordinationError', code }`，包括 `EXECUTOR_UNAVAILABLE`、graph validation failure、ownership 可见的 unknown id 和 `RESOURCE_LIMIT`。

<a id="config"></a>
## Config

| Key | 含义 |
|---|---|
| `defaultExecutor` | 任务省略 `executor` 时使用的 Executor kind，默认 `subagent`。 |
| `waitTimeoutMs` | `coordination_wait` 默认等待时间，默认 `30000`。 |
| `maxWaitTimeoutMs` | 模型指定等待时间的硬上限，默认 `600000`。 |

<a id="model-experience"></a>
## Model Experience

### Tool schemas and results

#### 模型看到的内容

模型会看到 [tool catalog](../../../docs/tool-catalog.zh.md#tool-package-map) 中生成的六个 schema，以及每次调用的一段 JSON 文本结果。Start 返回生成的 run id 和所有已安装 task id。Status、wait 与 cancel 返回 detached task/run projection；wait 额外返回 `timedOut`。

#### Token 影响

固定成本来自六个 tool schema，数据相关成本来自 JSON result。Run status 随任务数量增长；task status 除 Executor output 外保持常量规模。

#### KV Cache 影响

配置和 tool scope 不变时，tool schema 保持 prefix-stable。每个结果都是 conversation suffix 的追加内容。

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Consumer 只拥有通过自身工具启动的 run。Host 启动的 run 和其他 Consumer 创建的 run 会保持不可访问。
- Ownership 与 run/task index 仅存在于进程内。持久 coordination 需要带持久 ownership 与 authenticated Host operation 的 Provider。
- Approval gate 仍保留在 `ctx.coordination`，但不会暴露给模型；approval decision 归 human 或 policy adapter 所有。
- 这些工具不会创建 Git branch 或 worktree。隔离仍是可选 Executor 或 execution-host policy。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本包不发布运行时不变式伴生入口，因为 Consumer 的 ownership index 是通过工具操作验证的私有 enforcement state；本包不发布可供交叉检查的独立事件流或持久投影。

</details>
