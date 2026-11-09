---
description: "SQLite 持久化 Coordination 提供方：预写日志、崩溃恢复，任务图语义与内存提供方一致。"
kind: "package-reference"
---

# coordination-sqlite

[English](README.md) | 中文

## 摘要

跨进程重启运行任务图：每次转移先写入 SQLite 支撑的键值日志单元，之后才对外可见或可观察。

## 使用本包

本提供方镜像内存版 coordination 提供方的准入、保留、取消与释放语义，并增加持久层：每次转移都先过显式状态机表校验，提交日志，落到内存，然后才 emit 或 resolve。进程死亡时在途的 run，在下一次启动恢复时以 `execution interrupted by process restart` 落为 `failed`；已准入但尚未派发的任务从日志状态恢复，在其 executor kind 注册且下一次泵运行时派发。恢复泵不会因 executor 尚未注册而错杀就绪任务——留给下一次泵派发，使启动后基于 effect 的注册窗口不会毁掉可恢复的工作。

因日志存储介质不同，本提供方的任务输入输出门与内存版有一处分歧：值还必须经得起 JSON 往返（非有限数会被拒绝，否则 JSON 会静默置空）；超大成功产物降级为有界的 `failed` 结算，而不是保留。

日志历史只追加：驱逐只从内存移除 run，从不删除日志记录，新进程可以审计完整转移历史。畸形或被篡改的日志记录让启动以 `INVALID_TRANSITION` 大声失败，而不是被跳过。日志写按服务串行；一次写失败会毒化后续所有操作，而不是容忍内存与日志分叉。监听器与挂起的审批属于进程本地：恢复不把日志重放进监听器回调，崩溃进程的挂起审批对新进程不可见。

## 目录

- [配置](#config)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="config"></a>
## Config

| 键 | 含义 |
|---|---|
| `backend` | 提供日志单元的存储后端注册名（默认 `sqlite`）。 |
| `unit` | 承载日志的键值单元名（默认 `coordination`）。 |
| `maxConcurrency` | 进程内活跃 executor 调用上限（默认 `4`）。 |
| `maxActiveRuns` | 同时保留的非终态 run 上限（默认 `16`）。 |
| `maxTasksPerRun` | 单个 run 安装的任务数上限（默认 `128`）。 |
| `maxRetainedRuns` | 供后续读取保留的终态 run 上限（默认 `32`）。 |
| `maxRetainedBytes` | 任务声明与产物合计的 V8 序列化字节上限（默认 `16777216`）。 |

服务声明了 cordis 注入 `storage`：先装 storage hub 与一个后端提供方（如 `@deepseek-ai/dsh-storage-sqlite`）再挂本插件，否则 fiber 不会激活。

<a id="model-experience"></a>
## Model Experience

### 不直接进入模型上下文

#### 模型看到什么

本提供方不贡献任何面向模型的工具或提示词。通过 `ctx.coordination` 注册的 Executor Consumer 决定任务产物如何进入 Session 或模型。

#### Token 影响

对 token 零直接影响；进入模型请求的有界产物由 Executor Consumer 负责。

#### KV Cache 影响

无直接影响；任务产物造成的请求后缀变化由 Executor Consumer 负责。

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

语义执行状态，沿用合同的 `defined-not-enforced` 标注约定：

| 语义 | 状态 |
|---|---|
| WAL 顺序（日志提交先于 emit/resolve） | enforced——journal-discipline 测试钉住 |
| 崩溃恢复（中断任务落 failed、不重复派发、ready 续跑） | enforced——recovery 套件钉住 |
| 显式转移表 | enforced——每次变更都过 `assertTaskTransition`/`assertRunTransition` |
| 日志压缩 | defined-not-implemented——日志无限增长；按驱逐水位压缩列为后续项 |
| 跨进程互斥 | not-defined——两进程开同一单元无协调保证 |

- 仅单进程持久：没有跨进程租约，两个进程并发打开同一单元时无协调保证。
- 日志无限增长；压缩暂缓，等消费者需要再做。
- SQLite 是 Node 实验性内建（`node:sqlite`）；该约束由底层后端承担。
- 忽略 `AbortSignal` 的 executor 会拖慢终态取消与提供方释放。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者的工作上下文——点开查看</summary>

WAL 顺序契约（校验 → 日志提交 → 内存变更 → emit/resolve）是 journal-discipline 测试钉住的不变量：单个成功任务，日志必须恰好持有 emit 时间线展示的那十条记录，且每条严格先于它的观察。`cancel` 与 `decideApproval` 保持同步签名、内部入队；`start`/`addTask` 是真异步，因为返回值会被调用方同步消费。

</details>
