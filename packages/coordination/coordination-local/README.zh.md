---
description: "提供有界任务调度、保留、取消与执行器生命周期的进程内 Coordination Provider。"
kind: "package-reference"
---

# dsh-coordination-local

[English](README.md) | 中文

## 概述

在配置的并发与保留限制下，使用已注册 Executor 运行内存中的任务图。

## 使用本包

此 Provider 将任务图保存在内存中，并按配置的并发、active run、单 run task、终态 run 保留数量和序列化保留字节上限运行已注册的 Executor。任务发布前会校验 dependency 与 parent link，包括两类循环。依赖失败或取消时，所有传递阻塞的任务都会被取消，包括按反向依赖顺序声明的图和运行期间动态添加的任务。

Executor 返回显式 `TaskOutcome`；普通输出只放在成功结果的 `output` 字段中，因此数据对象不会被误判为生命周期控制。任务输入和成功输出必须可被 structured clone。Provider 会在准入、结算和每次读取 snapshot 时创建独立副本，调用方或 Executor 的修改不会改变保留的任务状态。

调用方提供的 task id 会在对应 task 仍被保留期间保持占用。使用任何已保留 run 占用的 id 启动另一个 run 或添加 task 时，会在 Provider 改变状态或发出 event 前失败。

终态 run 按完成顺序保留。超过终态 run 数量上限，或为了让 task declaration/outcome 满足保留字节上限而需要释放空间时，Provider 会回收最早的终态 run。回收会删除 run 及其 task、释放 id，并发出 `run/evicted`；后续读取以 `UNKNOWN_RUN` 或 `UNKNOWN_TASK` 失败。Active run、task 数量和 declaration 字节限制以 `RESOURCE_LIMIT` 拒绝。如果成功的 Executor outcome 在可回收旧终态 run 后仍无法容纳，该 task 会以有界资源诊断失败；过大的 failure/cancellation 诊断保持原生命周期状态，但替换为有界消息。

取消会使用调用方提供的 reason 中止运行中的 Executor，并等待这些 Executor 调用返回后再结算 run。Provider disposal 会先停止 Listener 分发并拒绝待处理审批，再中止非终态任务、等待所有运行中的 Executor 完成，最后清理内存状态。消息、审批和审计 Listener 抛出异常或返回 rejected promise 时会被记录并隔离，不会影响后续 Listener 或生命周期提交。

## 目录

- [配置](#config)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="config"></a>
## Config

| Key | 含义 |
|---|---|
| `maxConcurrency` | 进程内同时运行的 Executor 调用上限，默认 `4`。 |
| `maxActiveRuns` | 同时保留的非终态 run 上限，默认 `16`。 |
| `maxTasksPerRun` | 单个 run 可安装的 task 上限，默认 `128`。 |
| `maxRetainedRuns` | 为后续读取保留的终态 run 上限，默认 `32`。 |
| `maxRetainedBytes` | task declaration 与 outcome 的 V8 序列化保留字节总上限，默认 `16777216`。 |

<a id="model-experience"></a>
## Model Experience

### 不直接提供模型上下文

#### 模型看到的内容

此 Provider 不提供 model-facing tool 或 prompt。通过 `ctx.coordination` 注册的 Executor Consumer 决定任务输出如何进入 Session 或模型。

#### Token 影响

直接 token 影响为零；进入 model request 的有界输出由 Executor Consumer 负责。

#### KV Cache 影响

没有直接影响；task output 导致的 request suffix 变化由 Executor Consumer 负责。

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- 进程退出会丢失状态。
- 序列化字节计量不包含 JavaScript object overhead 和 Executor 的瞬时分配。
- 此 Provider 没有跨进程 lease、Git 隔离或 UI。
- 忽略 `AbortSignal` 的 Executor 可能延迟取消终态和 Provider disposal。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本包不发布运行时不变式伴生入口，因为 graph projection、retention accounting 与发出的 lifecycle snapshot 都来自同一份私有 scheduler state；本包没有可独立偏离的第二项观测。

</details>
