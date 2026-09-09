# Git（版本控制操作）分析

> 来源：staged-final-b84814d3 | 版本：0.1.0-rc.8
> 日期：2026-09-09

## 概述

Git 是只读 Git 操作能力。模型可以通过工具查询当前工作区仓库的状态、diff 和日志。**不含写入操作**——mutation、publication 和 worktree 隔离是独立的 Consumer 和 Provider，不属于此 seam。

## 包结构

| 包 | 角色 | 说明 | src 大小 |
|----|------|------|---------|
| `git/git` | Service Definition | `ctx.git` 抽象接口 | 3 文件, 5.2KB |
| `git/git-local` | Service Provider | 本地 git 命令执行 | 2 文件, 16.5KB |
| `git/tool-git` | Tool Consumer | 模型工具 | 2 文件, 9.5KB |

## Service Definition（`git/git`）

`ctx.git: GitRuntime`（抽象类继承 `Service`）

### 核心方法

| 方法 | 说明 |
|------|------|
| `resolveRepository(request)` | 解析目录所属的规范仓库 |
| `status(repository, signal?)` | 返回结构化工作树状态 |
| `diff(request)` | 返回有界 diff 观察 |
| `log(request)` | 返回最近的提交日志 |

### 类型

- `GitRepositoryId` — Branded 标识符
- `GitRepository` — `{ root, head }` 规范仓库身份
- `GitStatus` — 分支和文件计数
- `GitDiff` — diff 文本 + 截断状态
- `GitLogEntry` — 结构化提交条目
- `GitResolveRequest` — `{ path, signal? }`
- `GitDiffRequest` — `{ repository, maxBytes, signal? }`
- `GitLogRequest` — `{ repository, maxEntries, signal? }`

## Service Provider（`git/git-local`）

376 行。通过 `ctx.subprocess` 执行本地 git 命令。

### 配置

| 字段 | 说明 |
|------|------|
| `executable` | git 可执行文件名或路径 |
| `maxOutputBytes` | 单次观察最大 stdout/stderr 字节 |
| `maxLogEntries` | 单次日志请求最大提交数 |
| `graceMs` | 子进程优雅终止超时 |

### 安全特性

**环境墓碑** — 清除所有 `GIT_*` 环境变量，防止仓库选择或命令配置被重定向：

```ts
const GIT_ENVIRONMENT_TOMBSTONES = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CEILING_DIRECTORIES',
  'GIT_COMMON_DIR', 'GIT_CONFIG', 'GIT_CONFIG_COUNT',
  'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_SYSTEM', 'GIT_DIR', 'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_GRAFT_FILE', 'GIT_INDEX_FILE', 'GIT_NAMESPACE',
  'GIT_OBJECT_DIRECTORY', 'GIT_REPLACE_REF_BASE', 'GIT_SHALLOW_FILE',
  'GIT_WORK_TREE',
]
```

**只读环境**：
- `GIT_ATTR_NOSYSTEM=1`
- `GIT_CONFIG_GLOBAL=/dev/null`
- `GIT_CONFIG_NOSYSTEM=1`
- `GIT_OPTIONAL_LOCKS=0`
- `LANG=C` / `LC_ALL=C`

**filter 配置过滤** — 拒绝 `filter.*.clean` 和 `filter.*.process` 配置，防止外部进程注入。

**Git 2.25 兼容** — 使用 `core.fsmonitor=false` 等兼容参数。

## Tool Consumer（`git/tool-git`）

259 行。注册 3 个只读工具。

### 工具

| 工具 | 说明 |
|------|------|
| `git_status` | 读取分支、分叉和工作树计数 |
| `git_diff` | 读取工作树 diff |
| `git_log` | 读取最近提交 |

### 安全设计

- **工作区绑定** — `workspacePath()` 从调用 Agent 的 session header 获取 `cwd`，不接受模型指定路径
- **Agent 验证** — `ctx.agents.get(agent.id) !== agent` 确保是活跃调用 Agent
- **只读** — 所有工具不修改仓库

### inject

`['agents', 'tools', 'git']`

## Bundle

staged-final 没有 `bundle/cinlan-git` 或类似 bundle。Git 工具可能通过其他 bundle（如 TUI）集成。

## 与其他能力的关系

- `subprocess` — git-local 通过 `ctx.subprocess` 执行 git 命令
- `agent` — 工具从 Agent session 获取工作区路径
- `execution-host` — 远程执行主机上的 git 操作通过 fs/subprocess 适配器

## main 中是否存在

❌ main 没有 `git/` 顶层包组。需要完整迁移。
