# Orca ↔ Harness 术语对照表

本文档用于统一 Orca 和 Harness 之间的概念映射，避免迁移过程中的混淆。

---

## 核心概念

| Orca 术语 | Harness 术语 | 说明 |
|-----------|--------------|------|
| **Orca** | **Harness** | 项目名称 |
| **CLI Process** | **LLM Session** | Orca 管理本地命令行进程，Harness 管理 LLM API 会话 |
| **stdin/stdout** | **HTTP Stream / WebSocket** | 数据传输方式 |
| **process.kill()** | **AbortController.abort()** | 终止机制 |
| **orcasettings** | **harness.config** / **settings.json** | 配置文件名 |

---

## 架构组件

### 调度与执行

| Orca 术语 | Harness 术语 | 位置 | 说明 |
|-----------|--------------|------|------|
| **Director** | **SessionManager** | `extensions/session/manager.py` | 顶层调度器，管理多个会话 |
| **Cell** | **Session** / **SessionController** | `extensions/session/controller.py` | 单个执行单元，管理一个 LLM 会话的生命周期 |
| **Runtime** | **Context** / **ExecutionContext** | `core/context.py` | 运行时环境，提供工具、配置等上下文 |
| **Pty Handler** | **StreamHandler** | `extensions/io/stream_handler.py` | Orca 处理伪终端，Harness 处理流式响应 |

### 配置系统

| Orca 术语 | Harness 术语 | 位置 | 说明 |
|-----------|--------------|------|------|
| **GlobalSettings** | **GlobalConfig** | `extensions/settings/global_config.py` | 全局配置对象 |
| **UserSettings** | **UserConfig** | `extensions/settings/user_config.py` | 用户级配置 |
| **ProjectSettings** | **ProjectConfig** | `extensions/settings/project_config.py` | 项目级配置 |
| **SettingsManager** | **ConfigLoader** | `extensions/settings/loader.py` | 配置加载器 |
| **orcasettings.json** | **harness.config.json** | 项目根目录 | 配置文件 |

### 通信层

| Orca 术语 | Harness 术语 | 位置 | 说明 |
|-----------|--------------|------|------|
| **Relay** | **RelayServer** | `extensions/relay/server.py` | 中继服务器 |
| **E2EE Contract** | **EncryptionProtocol** | `extensions/relay/crypto.py` | 端到端加密协议 |
| **Mobile Protocol** | **MobileRPC** | `extensions/mobile/rpc.py` | 移动端 JSON-RPC 协议 |
| **Pairing** | **DevicePairing** | `extensions/mobile/pairing.py` | 设备配对流程 |
| **Phone Connection** | **MobileConnection** | `extensions/mobile/connection.py` | 移动端连接管理 |

### UI 组件

| Orca 术语 | Harness 术语 | 位置 | 说明 |
|-----------|--------------|------|------|
| **TerminalPane** | **TerminalView** | `ui/terminal/view.py` | 终端界面 |
| **SettingsPane** | **SettingsView** | `ui/settings/view.py` | 设置界面 |
| **EditorPanel** | **EditorView** | `ui/editor/view.py` | 编辑器界面 |
| **DiffViewer** | **DiffView** | `ui/editor/diff_view.py` | Diff 对比视图 |
| **FileExplorer** | **WorkspaceView** | `ui/workspace/view.py` | 文件浏览器 |

### 任务管理

| Orca 术语 | Harness 术语 | 位置 | 说明 |
|-----------|--------------|------|------|
| **Task** | **Job** | `extensions/scheduler/job.py` | 后台任务 |
| **TaskManager** | **JobScheduler** | `extensions/scheduler/scheduler.py` | 任务调度器 |
| **TaskQueue** | **JobQueue** | `extensions/scheduler/queue.py` | 任务队列 |
| **TaskStatus** | **JobStatus** | `extensions/scheduler/status.py` | 任务状态 |

### 工具与集成

| Orca 术语 | Harness 术语 | 位置 | 说明 |
|-----------|--------------|------|------|
| **Tool** | **Tool** | `core/tools/base.py` | 工具基类（Harness 原生） |
| **MCP** | **MCP Adapter** | `extensions/tools/mcp_adapter.py` | Model Context Protocol 适配器 |
| **Automation** | **Automation** / **Hook** | `extensions/automation/rule.py` | 自动化规则 |
| **Git Handler** | **GitIntegration** | `extensions/git/integration.py` | Git 集成 |

---

## 状态和生命周期

### 会话状态

| Orca 术语 | Harness 术语 | 说明 |
|-----------|--------------|------|
| **idle** | **idle** | 空闲状态 |
| **starting** | **initializing** | 启动中 |
| **running** | **active** | 运行中 |
| **paused** | **suspended** | 已暂停 |
| **stopping** | **terminating** | 停止中 |
| **stopped** | **terminated** | 已停止 |
| **crashed** | **failed** | 崩溃/失败 |

### 任务状态

| Orca 术语 | Harness 术语 | 说明 |
|-----------|--------------|------|
| **pending** | **queued** | 排队中 |
| **running** | **executing** | 执行中 |
| **completed** | **succeeded** | 已完成 |
| **failed** | **failed** | 失败 |
| **cancelled** | **aborted** | 已取消 |
| **retrying** | **retrying** | 重试中 |

---

## 数据结构

### 配置字段

| Orca 字段 | Harness 字段 | 类型 | 说明 |
|-----------|--------------|------|------|
| `api_key` | `llm_api_key` | string | LLM API 密钥 |
| `model_name` | `default_model` | string | 默认模型名称 |
| `max_tokens` | `max_output_tokens` | int | 最大输出 Token 数 |
| `temperature` | `temperature` | float | 温度参数 |
| `stream` | `enable_streaming` | bool | 是否启用流式输出 |
| `timeout` | `request_timeout` | int | 请求超时时间（秒） |

### 通信协议

| Orca 字段 | Harness 字段 | 类型 | 说明 |
|-----------|--------------|------|------|
| `jsonrpc` | `jsonrpc` | string | JSON-RPC 版本 |
| `method` | `method` | string | RPC 方法名 |
| `params` | `params` | object | 方法参数 |
| `id` | `request_id` | string | 请求 ID |
| `encrypted_payload` | `cipher_text` | string | 加密负载 |
| `nonce` | `iv` | string | 初始化向量（IV） |

---

## 特殊概念翻译

### Orca 特有概念 → Harness 对应实现

| Orca 概念 | 含义 | Harness 实现方式 |
|-----------|------|------------------|
| **Bun Runtime** | Orca 使用 Bun 作为 JS 运行时 | Harness 使用 Python/Go/Rust 原生运行时 |
| **Pty (伪终端)** | Orca 通过 pty 与 CLI 交互 | Harness 直接通过 HTTP/WebSocket 与 LLM API 交互 |
| **Claude CLI** | Orca 包装的本地 Claude CLI | Harness 直接调用 Anthropic API（或其他 LLM API） |
| **Mobile Companion** | Orca 的移动端伴侣 App | Harness 的移动端客户端（通过中继连接） |
| **Relay Server** | Orca 的中继服务器 | Harness 的中继服务器（同名但实现不同） |
| **E2EE v2** | Orca 的端到端加密协议 v2 | Harness 的加密协议（提取 Orca 规范后重写） |

### Harness 特有概念（Orca 不存在）

| Harness 概念 | 含义 | 说明 |
|--------------|------|------|
| **Context Window** | LLM 上下文窗口 | Harness 需要管理 LLM 的上下文，Orca 不需要 |
| **Token Budget** | Token 预算 | Harness 需要控制 API 成本，Orca 本地运行无此概念 |
| **Model Routing** | 模型路由 | Harness 可能支持多个 LLM 提供商，Orca 固定为 Claude |
| **Streaming Parser** | 流式解析器 | Harness 需要解析 Server-Sent Events (SSE)，Orca 解析 stdout |

---

## 命令与 API

### Orca 命令行 → Harness API

| Orca CLI 命令 | Harness API 方法 | 说明 |
|---------------|------------------|------|
| `orca start` | `SessionManager.create_session()` | 启动新会话 |
| `orca stop` | `SessionController.terminate()` | 停止会话 |
| `orca pause` | `SessionController.suspend()` | 暂停会话 |
| `orca resume` | `SessionController.resume()` | 恢复会话 |
| `orca list` | `SessionManager.list_sessions()` | 列出所有会话 |
| `orca config` | `ConfigLoader.get_config()` | 获取配置 |

---

## 文件路径约定

### Orca 路径 → Harness 路径

| Orca | Harness | 说明 |
|------|---------|------|
| `~/.config/orca/` | `~/.config/harness/` | 用户配置目录 |
| `~/.orca/settings.json` | `~/.harness/config.json` | 用户配置文件 |
| `.orca/project.json` | `.harness/project.json` | 项目配置文件 |
| `.orca/cache/` | `.harness/cache/` | 缓存目录 |
| `.orca/logs/` | `.harness/logs/` | 日志目录 |
| `orca-runtime.log` | `harness-session.log` | 运行时日志 |

---

## 使用建议

1. **迁移代码时**：遇到 Orca 术语，查本表找对应的 Harness 术语
2. **编写文档时**：优先使用 Harness 术语，括号注明 Orca 对应术语（首次出现时）
3. **讨论架构时**：明确指出是在说 Orca 的设计还是 Harness 的实现
4. **更新本表**：发现新的术语对照，立即补充到本文档

---

## 术语歧义警告

以下术语在 Orca 和 Harness 中**含义不同**，需要特别注意：

| 术语 | Orca 含义 | Harness 含义 | 区别 |
|------|-----------|--------------|------|
| **Runtime** | Orca 的运行时环境（提供工具、配置） | Harness 的核心引擎 | Orca 的 Runtime 更接近 Harness 的 Context |
| **Cell** | 单个 CLI 进程的封装 | 在 Harness 中不使用此术语 | 用 Session 替代 |
| **Stream** | stdout 流 | HTTP SSE 流或 WebSocket 流 | 传输方式完全不同 |
| **Task** | 后台任务 | LLM 推理任务（不同概念） | Orca 的 Task 对应 Harness 的 Job |

---

**最后更新**：2026-10-10  
**维护者**：迁移团队
