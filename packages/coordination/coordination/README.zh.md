---
description: "任务图、生命周期、诊断、消息、审批与执行器约定的 Coordination 服务定义。"
kind: "package-reference"
---

# dsh-coordination

[English](README.md) | 中文

## 概述

通过 provider-neutral service 管理任务标识、生命周期、诊断、审批、消息和审计事件。

## 使用本包

Service Definition 负责 branded run/task 标识符、DAG 校验、任务生命周期、typed diagnostics、任务消息、审批钩子和审计事件。只有所有任务进入终态且所有已准入的 Executor 调用完成后，run result 才会结算。Provider 决定调度与执行策略。

Executor 返回显式 `TaskOutcome`；成功数据放在其 `output` 字段中，不会与生命周期控制混淆。公开的 run/task snapshot、message、approval value 和 event payload 使用 readonly 字段。Provider 会给每个调用方和 Listener 提供独立副本，因此修改不会影响保留状态或其他 observer 的输入。

`TaskId` 在对应 task 仍被保留期间保持唯一，因为 task 查询、取消、消息和审批只使用 task id，不同时携带 `RunId`。复用已保留的 id 时，会在发布前以 `DUPLICATE_TASK` 失败。Provider 可以按已记录的保留策略回收终态 run；`run/evicted` 会报告此次移除，后续读取以 `UNKNOWN_RUN` 或 `UNKNOWN_TASK` 失败，已释放的 id 可以复用。

此服务不会创建 Git branch 或 worktree，不拥有 Agent loop，不持久化 transcript，也不提供 renderer。`coordination-local` 是进程内 Provider。

取消原因通过 `AbortSignal.reason` 传递给运行中的 Executor。取消 task 时会覆盖其 parent subtree，以及因为已取消依赖无法成功而被传递阻塞的所有任务。消息、审批请求和审计 Listener 只能观察已提交状态；Listener 抛出异常或返回 rejected promise 不会改变生命周期状态，也不会阻止后续 Listener。审批请求只会通过 `decideApproval`、任务取消或 Provider disposal 结算。

## 目录

- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## Model Experience

### 不直接提供模型上下文

#### 模型看到的内容

此包不提供 model-facing tool 或 prompt 文本。[`dsh-tool-coordination`](../tool-coordination/README.zh.md) 会通过 `ctx.tools` 暴露选定操作，而不会把工具所有权移入 Service Definition。

#### Token 影响

直接 token 影响为零；进入 model request 的 task projection 由 Consumer 负责。

#### KV Cache 影响

没有直接影响；task observation 导致的 request suffix 变化由 Consumer 负责。

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Service Definition 暂无持久化 Provider、远程 lease、预算计量或内置审批 UI。
- Executor 需要自行负责 Agent、Session、进程和 sandbox 的所有权。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本包不发布运行时不变式伴生入口，因为此 Service Definition 只拥有类型与注册约定，不拥有可变实现状态或可供比较的独立观测。

</details>
