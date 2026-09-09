# 散落在共享组中的差异包分析

> 来源：staged-final-b84814d3 | 版本：0.1.0-rc.8
> 日期：2026-09-09

## 概述

除了顶层包组差异外，staged-final 在共享组（guard、host、preset、session、subagent、test-support、web、code-runtime）中也有 main 不存在的包。

---

## 1. guard/turn-budget-policy（轮次预算策略）

| 项 | 值 |
|----|-----|
| src 大小 | 2 文件, ~10KB |
| inject | `['tools']` |

轮次预算限制插件，防止模型在单轮对话中消耗过多 token。通过 `ctx.tools` 的 pre-execute 事件检查累计 token 数，超限时拒绝执行。

---

## 2. host/apiproxy（API 代理）

| 项 | 值 |
|----|-----|
| src 大小 | 2 文件, ~172KB |
| 主要文件 | `api-proxy.ts` (167KB) |

API 代理核心，被 `api/codex-app-server` 使用。提供 RPC 方法到 Service 方法的映射、请求验证、错误处理。

main 没有此包，因为 main 用分散的控制器替代了集中式 RPC 映射。

---

## 3. preset/agent-execution-guidance（代理执行引导）

| 项 | 值 |
|----|-----|
| src 大小 | 2 文件, ~4.5KB |
| inject | `['systemPrompt']` |
| section name | `agent:execution-guidance` |
| order | 10 |

共享的代理执行行为提示词，安装在所有出厂 Agent 组合中。内容：

- 编辑前检查相关指令、源码和调用方
- 保留无关工作，使用最小完整变更
- 使用工具执行工作而非仅描述
- 保持计划状态，委派有界子任务，仅并行化独立工作
- 继续实现和验证，除非用户只要求分析或计划

---

## 4. session/session-persistence-sqlite（SQLite 会话持久化）

| 项 | 值 |
|----|-----|
| src 大小 | 5 文件, ~47KB |
| 主要文件 | `store.ts` (16.9KB), `codec.ts` (13.1KB), `compression.ts` (9.2KB) |
| inject | `['session']` |
| SCHEMA_VERSION | 单调递增 |

可选的 SQLite 持久化 Provider。逻辑会话不变，物理后端将符合条件的 chunk 运行打包到 schema-17 行。

### 配置

| 字段 | 说明 |
|------|------|
| `journalMode` | SQLite journal 模式 |
| `writeBatchMaxDelayMs` | 写入批处理最大延迟 |
| `preparedSessionCacheSize` | 预备会话缓存大小 |

### 依赖

- `@deepseek-ai/dsh-session-persistence` — `PersistenceCoordinator`、`SessionPersistence`

main 没有 SQLite 持久化，main 的 session 包有 `session-format` 迁移系列。

---

## 5. subagent/tool-subagent-report（子代理报告工具）

| 项 | 值 |
|----|-----|
| src 大小 | 2 文件, ~7KB |
| inject | `['subagents', 'tools', 'systemPrompt']` |

子代理范围的 `report` 工具，安装到每个可继续的进程内子代理的未发布上下文中。根代理、一次性子代理、远程 Provider 和无 Agent 执行不会看到此注册。

### 配置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `parentScheduling` | `next-step` | `next-step` 唤醒父代理；`quiet` 添加上下文不唤醒 |

### 工作流

1. 子代理调用 `report` 工具提交结果
2. 结果通过 `SubagentReportDelivery` 传递给父代理
3. 父代理根据 `parentScheduling` 决定是否立即处理

main 有 `subagent-claude-code` 和 `subagent-codex` 替代。

---

## 6. test-support/acp-snapshot（ACP 快照测试）

| 项 | 值 |
|----|-----|
| src 大小 | 4 文件, ~95KB |
| 主要文件 | `suite.ts` (74.9KB), `normalize.ts` (18KB) |
| 依赖 | vitest（仅测试时可用） |

ACP 快照测试套件工具包，是 keyless 快照测试层（`pnpm run test:snapshot`）的共享机制。

### 四层架构

1. **启动器** — `launchAcpTestAgent()` 共享子进程/客户端启动
2. **场景 harness** — `runScenario()` 脚本化场景
3. **规范化器** — `normalizeStdout` / `normalizeSessionLog` / `scrubRequestHeaders` / `scrubSystemPrompts`
4. **套件工厂** — `defineAcpSnapshotSuite()` 注册场景表为 describe/it 树

main 有 `test-support/session-snapshot` 替代。

---

## 7. web/web-permission-policy（Web 权限策略）

| 项 | 值 |
|----|-----|
| src 大小 | 2 文件, ~2.2KB |
| inject | `['sandboxPolicy', 'tools']` |

模型公共 Web 检索的审批策略。

### 行为

- `web_fetch` 工具需要审批，除非会话已运行在 `danger-full-access` 模式
- 其他工具直接放行

### 审批提示

> "Fetching a public URL contacts an external origin and can disclose data embedded in the URL. Allow this web_fetch call?"

---

## 8. code-runtime/code-runtime-python（Python 代码运行时）

| 项 | 值 |
|----|-----|
| src 大小 | 2 文件, ~33KB |
| 主要文件 | `protocol.ts` (32.2KB) |

CPython 子进程代码运行时，拥有 Node 主机和 CPython 子进程之间的无版本 fd-3 线协议。

### 导出

- `BindingErrorInfo`、`BootMessage`、`ChildToHost`、`ReplyMessage` — 协议类型
- `checkDoneValue`、`encodeJsonPlain`、`hasNonLosslessNumber`、`hasUnsafeIntegerToken`、`logTruncationMarker`、`validateChildFrame` — 协议工具

### 位置差异

- staged-final: `code-runtime/code-runtime-python`
- main: `experimental/code-runtime-python`

main 将此包移到了 experimental 下。

---

## 9. examples/（示例应用）

| 包 | src 大小 | 说明 |
|----|---------|------|
| `acp-demo` | 3 文件, 9.7KB | ACP 协议示例 |
| `agent-spine-demo` | 2 文件, 15.2KB | Agent Spine 示例 |
| `jsonrpc-demo` | 5 文件, 4.2KB | JSON-RPC 示例 |

开发参考用，非生产包。staged-final 的 `pnpm-workspace.yaml` 包含 `examples` 作为 workspace 成员（仅用于依赖解析，不是构建目标）。

---

## main 独有的包（staged-final 没有）

| 组 | 包 | 说明 |
|----|-----|------|
| `credentials` | `authorization` | 授权能力 |
| `experimental` | `agent-team` 等 9 个 | 代理团队、检查器、webworker |
| `llm` | `deepseek-llm-api-extensions` | LLM API 扩展 |
| `llm` | `plugin-package-inventory-deepseek` | 插件清单 |
| `session` | `session-format` 等 7 个 | 会话格式迁移 |
| `subagent` | `subagent-claude-code`、`subagent-codex` | Claude/Codex 子代理 |
| `subprocess` | `win32-process` | Win32 进程 |
| `test-support` | `session-snapshot` | 会话快照测试 |
| `util` | `crypto`、`deque` 等 7 个 | 工具库扩展 |

---

## 同步优先级

| 优先级 | 包 | 说明 |
|--------|-----|------|
| P1 | `session-persistence-sqlite` | SQLite 持久化，影响数据存储 |
| P1 | `agent-execution-guidance` | 共享执行引导，影响所有 Agent |
| P2 | `turn-budget-policy` | 轮次预算限制 |
| P2 | `web-permission-policy` | Web 权限策略 |
| P2 | `tool-subagent-report` | 子代理报告 |
| P3 | `apiproxy` | API 代理（与 codex-app-server 一起迁移） |
| P3 | `acp-snapshot` | 测试支持 |
| P3 | `code-runtime-python` | Python 运行时（main 已在 experimental 下） |
| P4 | `examples/*` | 示例应用 |
