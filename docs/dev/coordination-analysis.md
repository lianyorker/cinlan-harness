# Coordination（任务协调）分析

> 来源：staged-final-b84814d3 | 版本：0.1.0-rc.8
> 日期：2026-09-09

## 概述

Coordination 是任务 DAG（有向无环图）协调能力。模型可以声明有依赖关系的任务图，由注册的执行器（如子代理）并行执行，支持消息传递、审批门控和取消传播。

## 包结构

| 包 | 角色 | 说明 | src 大小 |
|----|------|------|---------|
| `coordination/coordination` | Service Definition | `ctx.coordination` 抽象接口 | 4 文件, 14KB |
| `coordination/coordination-local` | Service Provider | 进程内调度器 | 2 文件, 32.7KB |
| `coordination/coordination-subagent-executor` | Executor | 子代理执行器 | 2 文件, 9.7KB |
| `coordination/tool-coordination` | Tool Consumer | 模型工具 | 2 文件, 19.9KB |

## Service Definition（`coordination/coordination`）

`ctx.coordination: CoordinationService`（抽象类，直接实例化抛错）

### 核心方法

| 方法 | 说明 |
|------|------|
| `registerExecutor(kind, executor)` | 注册执行器类型，返回 disposer |
| `start(request)` | 验证并启动任务 DAG，返回 `CoordinationRun` |
| `getRun(id)` / `getTask(id)` | 读取快照 |
| `listTasks(runId)` | 列出运行中所有任务 |
| `addTask(runId, spec)` | 向活动运行添加任务 |
| `cancel(target, reason)` | 取消运行或任务（传播到依赖方） |
| `sendMessage(taskId, message, sender?)` | 发送任务消息 |
| `onMessage(listener)` | 注册消息观察者 |
| `requestApproval(request)` | 请求审批门控 |
| `decideApproval(decision)` | 解决审批门控 |
| `onApprovalRequest(listener)` | 注册审批适配器 |
| `onEvent(listener)` | 注册审计事件监听器 |

### CoordinationRun 句柄

- `snapshot` — 当前快照
- `result` — Promise，所有任务终态后 resolve
- `cancel(reason?)` — 取消所有非终态任务

### 类型

- `RunId`、`TaskId` — Branded 标识符
- `TaskSpec` — 任务声明（id、label、dependencies、executor、input、parentId?）
- `TaskStatus` — pending → running → succeeded/failed/cancelled
- `RunSnapshot` — 运行级快照
- `TaskSnapshot` — 任务级快照
- `TaskExecutor` — `(task, signal) => Promise<TaskOutcome>`
- `CoordinationApprovalRequest/Decision` — 审批门控

## Service Provider（`coordination/coordination-local`）

进程内调度器，788 行。

### 配置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `maxConcurrency` | — | 最大并发执行器调用数 |
| `maxActiveRuns` | — | 最大非终态运行数 |
| `maxTasksPerRun` | — | 单运行最大任务数 |
| `maxRetainedRuns` | — | 保留的终态运行数 |
| `maxRetainedBytes` | — | 保留的序列化字节上限 |

### 实现

- V8 序列化计算保留字节
- DAG 依赖解析：任务在所有依赖完成后变 ready
- 并发限制：`maxConcurrency` 控制同时执行的 executor 调用
- 取消传播：取消任务时，依赖它的任务也被取消
- 审批门控：`PendingApproval` 队列，超时/取消时 reject
- 终态运行驱逐：超过 `maxRetainedRuns` 时驱逐最旧的终态运行

## Subagent Executor（`coordination/coordination-subagent-executor`）

将子代理注册为协调执行器。

### 配置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `provider` | — (必填) | `ctx.subagents` 上的 Provider id |
| `executorKind` | `subagent` | 注册的执行器类型名 |
| `maxDependencyContextChars` | 32000 | 依赖结果附加到子代理 prompt 的最大字符数 |
| `agentOptions` | — (必填) | provider/model/maxTokens |
| `persona` | — | 子代理人格 |
| `toolFilter` | — | allow/deny 工具过滤 |
| `maxDepth` | 3 | 子代理最大委派深度 |

### 输入格式

```ts
{ prompt: string, parentAgentId: string }
```

### 工作流

1. 读取已完成依赖的结果，截断到 `maxDependencyContextChars`
2. 组装子代理 prompt（依赖上下文 + 任务 prompt）
3. 通过 `ctx.subagents` 启动子代理
4. 返回 `TaskOutcome`

## Tool Consumer（`coordination/tool-coordination`）

模型工具，448 行。

### 注册的工具

| 工具 | 说明 |
|------|------|
| `coordination_start_run` | 启动任务 DAG |
| `coordination_add_task` | 向运行添加任务 |
| `coordination_get_run` | 读取运行快照 |
| `coordination_get_task` | 读取任务快照 |
| `coordination_list_tasks` | 列出运行任务 |
| `coordination_wait` | 等待运行/任务完成（有超时） |
| `coordination_cancel` | 取消运行/任务 |
| `coordination_send_message` | 发送任务消息 |

### 配置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `defaultExecutor` | `subagent` | 任务省略 executor 时的默认值 |
| `waitTimeoutMs` | 30000 | 等待默认超时 |
| `maxWaitTimeoutMs` | 600000 | 等待最大超时 |

## 与其他能力的关系

- `subagent` — 子代理执行器依赖 `ctx.subagents`
- `agent` — 执行器需要 `ctx.agents`
- `session` — `SessionId`/`snapshotJsonValue` 来自 session 包
- `browser` — integration 的 `tool-browser-element-capture` 依赖 coordination 执行器

## main 中是否存在

❌ main 没有 `coordination/` 顶层包组。需要完整迁移。

## Bundle

staged-final 有 `bundle/cinlan-browser`（browser bundle 引用 coordination），但 coordination 本身没有独立 bundle。
