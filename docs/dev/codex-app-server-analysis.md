# Codex App Server 分析

> 来源：staged-final-b84814d3 | 版本：0.1.0-rc.8
> 日期：2026-09-09

## 概述

Codex App Server 是基于 JSON-RPC 的远程 API 服务器，为 Codex TUI 和其他客户端提供会话管理、工具调用、子代理、设置等 RPC 接口。包含 API 代理层和 Fetch 处理器。

## 包结构

| 包 | 角色 | 说明 | src 大小 |
|----|------|------|---------|
| `api/codex-app-server` | API 服务器 | RPC 映射 + API 代理 + Fetch 处理 | ~30 文件, ~400KB |
| `api/codex-app-server-harness` | Harness 适配 | 启动器和规范化 | 3 文件, ~30KB |

## API 服务器（`api/codex-app-server`）

### 源文件结构

**API 层（`api/`）**：

| 文件 | 大小 | 说明 |
|------|------|------|
| `api-proxy.ts` | 167KB | API 代理核心（最大文件） |
| `index.ts` | 5.3KB | API 导出 |
| `rpc-map.ts` | 4.2KB | RPC 方法映射 |
| `rpc.ts` | 8.2KB | RPC 协议 |
| `rpc.schema.ts` | 9.6KB | RPC schema 定义 |
| `sessions.ts` | 17.4KB | 会话管理 RPC |
| `sessions.schema.ts` | 15.1KB | 会话 schema |
| `settings.ts` | 4.9KB | 设置 RPC |
| `settings.schema.ts` | 3.6KB | 设置 schema |
| `workspace.ts` | 5.3KB | 工作区 RPC |
| `workspace.schema.ts` | 5KB | 工作区 schema |
| `subagents.ts` | 4KB | 子代理 RPC |
| `subagents.schema.ts` | 3.4KB | 子代理 schema |
| `host.ts` | 3.9KB | 主机 RPC |
| `host.schema.ts` | 3KB | 主机 schema |
| `llm.ts` | 3.9KB | LLM RPC |
| `llm.schema.ts` | 2.8KB | LLM schema |
| `events.ts` | 8.6KB | 事件 RPC |
| `events.schema.ts` | 5.7KB | 事件 schema |
| `goals.ts` | 2.3KB | 目标 RPC |
| `goals.schema.ts` | 3.1KB | 目标 schema |
| `skills.ts` | 1.5KB | 技能 RPC |
| `skills.schema.ts` | 948B | 技能 schema |
| `questions.ts` | 777B | 问答 RPC |
| `questions.schema.ts` | 1.1KB | 问答 schema |
| `jobs.ts` | 1.4KB | 任务 RPC |
| `jobs.schema.ts` | 1.1KB | 任务 schema |
| `approvals.ts` | 1KB | 审批 RPC |
| `approvals.schema.ts` | 1KB | 审批 schema |
| `credentials.ts` | 2KB | 凭据 RPC |
| `credentials.schema.ts` | 2.1KB | 凭据 schema |
| `design.ts` | 1.6KB | 设计 RPC |
| `design.schema.ts` | 2KB | 设计 schema |
| `downloads.ts` | 1.1KB | 下载 RPC |
| `downloads.schema.ts` | 1.1KB | 下载 schema |
| `session-search.ts` | 741B | 会话搜索 |
| `native-path-opener.ts` | 11.1KB | 原生路径打开 |
| `session-export.ts` | 18.9KB | 会话导出 |
| `agent-presets.ts` | 5.4KB | Agent 预设 |
| `agent-presets.schema.ts` | 3.4KB | Agent 预设 schema |
| `index.ts` | 4.4KB | API 导出 |

**Fetch 层（`fetch/）**：

| 文件 | 大小 | 说明 |
|------|------|------|
| `client.ts` | 32.7KB | API 客户端（`AbstractApiClient`、`InProcessApiClient`） |
| `handler.ts` | 19.7KB | Fetch 请求处理器 |
| `index.ts` | 2KB | 导出 |

**会话导出**：

| 文件 | 说明 |
|------|------|
| `session-export.ts` (18.9KB) | 会话日志压缩和导出 |

### 核心 RPC 接口

| 域 | 方法示例 |
|----|---------|
| 会话 | create/list/resume/delete/search/export |
| 设置 | read/write/reset |
| 工作区 | list/read/write/search |
| 子代理 | list/status/cancel |
| 主机 | status/execute |
| LLM | list-models/switch-model |
| 事件 | subscribe/unsubscribe |
| 目标 | create/list/update/delete |
| 技能 | list/invoke |
| 问答 | ask/answer |
| 任务 | list/status/cancel |
| 审批 | request/decide |
| 凭据 | list/store/delete |
| 设计 | create/read/update/list/preview/export |
| 下载 | list/cancel |

### API 代理

`api-proxy.ts`（167KB）是最大的单文件，包含：
- RPC 方法到 Service 方法的映射
- 请求验证和参数转换
- 错误处理和响应格式化
- 会话日志压缩（`DEFAULT_SESSION_LOG_COMPRESSION_LEVEL`）

### Fetch 处理器

`toFetchHandler()` — 将 RPC 转为标准 Fetch handler，可挂载到 HTTP 服务器。

### API 客户端

- `AbstractApiClient` — 抽象客户端基类
- `InProcessApiClient` — 进程内客户端（不走网络）

## Harness 适配（`api/codex-app-server-harness`）

| 文件 | 大小 | 说明 |
|------|------|------|
| `index.ts` | 1.7KB | 导出 |
| `invariant.ts` | 1.1KB | 运行时不变量 |
| `launcher.ts` | 12.6KB | 启动器 |
| `normalize.ts` | 18KB | 输出规范化 |

### 功能

- 启动 Codex App Server 进程
- 规范化输出用于快照测试
- 连接 TUI 传输层

## 与其他能力的关系

- `interaction/codex-tui` — 通过此服务器连接
- `session` — 会话管理 RPC
- `subagent` — 子代理 RPC
- `settings` — 设置 RPC
- `workspace` — 工作区 RPC
- `design-studio` — 设计 RPC
- `credentials` — 凭据 RPC

## main 中是否存在

❌ main 没有 `api/codex-app-server` 和 `api/codex-app-server-harness`。

main 用不同的 API 控制器替代：
- `api/session-controller`
- `api/settings-controller`
- `api/workspace-controller`
- `api/workspace-files`

两者架构不同：staged-final 用集中式 RPC 映射，main 用分散式控制器。

## 注意事项

- `api-proxy.ts` 167KB 是全仓库最大单文件，迁移时需特别关注
- `test-support/acp-snapshot` 依赖此包的 `normalize.ts` 做快照测试
- `InProcessApiClient` 允许不走网络的进程内调用
