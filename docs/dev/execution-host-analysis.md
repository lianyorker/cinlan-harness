# Execution Host（远程执行主机）分析

> 来源：staged-final-b84814d3 | 版本：0.1.0-rc.8
> 日期：2026-09-09

## 概述

Execution Host 是远程执行环境抽象。通过注册的 Provider（本地或 SSH），为 Agent 提供隔离的文件系统和子进程服务。支持代际检查的租约机制，确保主机重注册后旧租约失效。

## 包结构

| 包 | 角色 | 说明 | src 大小 |
|----|------|------|---------|
| `execution-host/execution-host` | Service Definition | `ctx.executionHosts` 注册和租约 | 3 文件, 18KB |
| `execution-host/execution-host-local` | Service Provider | 本地执行 | 2 文件, 8.2KB |
| `execution-host/execution-host-ssh` | Service Provider | SSH 远程执行 | 9 文件, 128.3KB |
| `execution-host/execution-host-bind` | Consumer | 将主机绑定到 Agent 预设域 | 2 文件, 17.7KB |

## Service Definition（`execution-host/execution-host`）

`ctx.executionHosts: ExecutionHostRegistry`

### 核心概念

- **Host** — 一台注册的执行主机（id、kind、platform、cwd、capabilities）
- **Generation** — 主机重注册时递增的代际号
- **Lease** — 激活时获得的租约，携带代际号；主机重注册后旧租约变 stale
- **Capabilities** — `{ fs: boolean, subprocess: boolean }`

### 错误类型

| 错误 | 代码 | 说明 |
|------|------|------|
| `ExecutionHostError` | — | 基类 |
| `UnknownExecutionHostError` | `EXECUTION_HOST_UNKNOWN` | 未知主机 id |
| `StaleExecutionHostError` | `EXECUTION_HOST_STALE` | 租约代际过期 |

### 类型

- `ExecutionHostId` — Branded（非空字符串）
- `ExecutionHostKind`: `local` | `ssh`
- `ExecutionHostPlatform`: `win32` | `darwin` | `linux`
- `ExecutionHostDescriptor` — 注册描述符
- `ExecutionHostProviderLease` — `{ context, dispose }`
- `ExecutionHostRegistration` — 注册信息

## Local Provider（`execution-host/execution-host-local`）

196 行。

### 配置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `id` | `local` | 主机 id |
| `cwd` | `process.cwd()` | 文件系统根 |
| `platform` | 当前平台 | 必须匹配实际平台 |
| `diffBasisMaxBytes` | — | 文件系统 diff 基线限制 |

### 激活流程

1. 创建隔离的 Cordis 子上下文（`isolate('fs', ...)` + `isolate('subprocess', ...)`）
2. 在子上下文中加载 `LocalFileSystem` 和 `LocalSubprocessRuntime`
3. 返回 `{ context, dispose }` 租约
4. dispose 时按序清理子上下文

## SSH Provider（`execution-host/execution-host-ssh`）

443 行（index.ts），9 个源文件共 128KB。**最大的单个包**。

### 配置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `id` | `ssh` | 主机 id |
| `host` | — (必填) | SSH 主机名/地址 |
| `port` | 22 | SSH 端口 |
| `username` | — (必填) | SSH 账户 |
| `platform` | — (必填) | `linux` \| `darwin` |
| `workspaceRoot` | — (必填) | 远程工作区根（绝对路径） |
| `hostKeySha256` | — (必填) | OpenSSH 格式 SHA256 主机密钥 pin |
| `nodeCommand` | `node` | 远程 Node 可执行文件 |
| `auth` | — (必填) | `password` \| `private-key`（通过 credentialRef） |
| `maxFrameBytes` | 1MB | JSON 载荷上限 |
| `maxInFlight` | 32 | 最大未完成请求 |
| `requestTimeoutMs` | 30000 | 请求超时 |
| `processPollMs` | 25 | 进程组存活轮询间隔 |
| `diffBasisMaxBytes` | 1MB | 写 diff 基线上限 |

### 认证

通过 `@deepseek-ai/dsh-credentials` 的 `credentialRef` 引用：
- `password` — `passwordRef`
- `private-key` — `privateKeyRef` + `passphraseRef?`

### 源文件

| 文件 | 说明 |
|------|------|
| `index.ts` | Provider 主入口 |
| `filesystem.ts` | SSH 文件系统适配 |
| `subprocess.ts` | SSH 子进程运行时 |
| `session.ts` | SSH 会话工厂 |
| `ssh2-transport.ts` | ssh2 传输层 |
| `protocol.ts` | 远程 helper 协议（`SSH_HELPER_PROTOCOL_VERSION`） |
| `trust-fence.ts` | 信任围栏 |
| `wire.ts` | 线协议 |
| `invariant.ts` | 运行时不变量 |

### 安全特性

- **主机密钥 pin** — 必须提供 SHA256 pin，拒绝未知主机密钥
- **工作区根限制** — 文件系统路径和进程 cwd 限制在 `workspaceRoot` 内
- **环境墓碑** — 清除可能重定向仓库选择的 `GIT_*` 环境变量
- **凭据引用** — 密码/私钥通过 credential capability 引用，不直接暴露

## Bind Consumer（`execution-host/execution-host-bind`）

509 行。将固定主机发布到隔离的 Agent 预设域。

### 配置

| 字段 | 说明 |
|------|------|
| `hostId` | 注册的执行主机 id（必填） |

### 工作流

1. 通过 `ctx.executionHosts` 激活指定主机的租约
2. 在租约上下文中安装 `FileSystem` 和 `SubprocessRuntime` 适配器
3. 路径映射（posix ↔ win32）
4. 主机声明（`HOST_CLAIMS` Symbol）防止同一主机被多个 Binder 占用
5. 租约 dispose 时清理

### inject

`['agents', 'executionHosts']` — 需要 Agent 启动器和主机注册表

## Bundle

`bundle/execution-host-ssh` — SSH 执行主机 Bundle

## 与其他能力的关系

- `artifact` — `ArtifactAuthorization.executionHostId` 引用 `ExecutionHostId`
- `credentials` — SSH 认证通过 credential 引用
- `fs` / `subprocess` — 租约上下文中安装 fs 和 subprocess 适配器
- `agent` — Bind Consumer 将主机绑定到 Agent 预设域

## main 中是否存在

❌ main 没有 `execution-host/` 顶层包组。需要完整迁移。

## 注意事项

- SSH 包 128KB，是最大的单个包，迁移时需确认 `ssh2` 依赖
- `execution-host-bind` 使用 `posix`/`win32` 路径映射，跨平台兼容
- 代际检查机制确保主机重注册后旧租约自动失效
