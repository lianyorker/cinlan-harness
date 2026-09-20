---
description: "使用本地 CLI、校验 observation 并限制执行时长的 Provider。"
kind: "package-reference"
---

# @deepseek-ai/dsh-computer-use-cinlan

[English](README.md) | 中文

## 概述

使用本地 CLI、校验 observation 并限制执行时长的 Provider。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)

<a id="use-this-package"></a>
## 使用本包

这个 Service Provider 通过公开的 Cinlan JSON CLI 实现 [`ctx.computerUse`](../computer-use/README.zh.md)。每个操作都会通过 `ctx.subprocess` 启动一个基于 argv 的进程；观察与动作共享一个 Provider 实例级 `--session` 命名空间；完整 JSON envelope 通过验证后才会发布状态；整个过程不调用 shell。

插件设置会立即注册 Provider，不解析 executable 也不探测 capabilities。executable 解析和首次 CLI 调用在首次操作时懒执行，因此 Cinlan IDE CLI 缺失或未就绪不会阻断插件树。报告的平台和操作标志仍是 Cinlan IDE CLI 的事实；本包不内嵌操作系统自动化后端。

## 公开命令

| Computer Use 操作 | 配置 executable 之后的 CLI argv |
|---|---|
| `capabilities` | `computer capabilities --json` |
| `listApps` | `computer list-apps --json` |
| `listWindows` | `computer list-windows --app <appId> --json` |
| `observe` | `computer get-app-state --app <appId> [window/restore/screenshot flags] --session <sessionId> --json` |
| `click` | `computer click ... --session <sessionId> --json` |
| `performSecondaryAction` | `computer perform-secondary-action ... --session <sessionId> --json` |
| `scroll` / `drag` | `computer scroll|drag ... --session <sessionId> --json` |
| `typeText` / `pasteText` | `computer type-text|paste-text ... --text-stdin --session <sessionId> --json` |
| `pressKey` / `hotkey` | `computer press-key|hotkey ... --session <sessionId> --json` |
| `setValue` | `computer set-value ... --value-stdin --session <sessionId> --json` |

窗口 id 只接受规范的 `id:<number>` 或 `index:<number>` 形式。文本和值通过 subprocess stdin 而不是 argv 传输。Provider 只解析当前公开响应字段，拒绝进程状态与 envelope 不一致、重复身份或不一致身份，并将公开 CLI 失败映射为结构化 `ComputerUseError` code。

## 配置

| Key | 默认值 | 含义 |
|---|---|---|
| `providerId` | `cinlan` | 注册到 `ctx.computerUse` 的 Provider id。 |
| `command` | `orca`（Linux 为 `orca-ide`） | 由 `ctx.subprocess` 解析的裸 executable 名称或绝对路径。 |
| `cwd` | `process.cwd()` | 子进程工作目录。 |
| `commandTimeoutMs` | `65000` | executable 查找及每个命令的 deadline。 |
| `graceMs` | `3000` | 子进程从 TERM 到 KILL 的宽限时间。 |
| `maxJsonBytes` | `16777216` | 完整 stdout JSON 字节上限。 |
| `maxStderrBytes` | `65536` | 捕获 stderr 的字节上限。 |
| `maxImageBytes` | `16777216` | attachment 持久化前的截图字节上限。 |

未知 key、带首尾空白或空字符串、非整数上限、非正上限、不安全整数，以及超过 Node 支持延时的 timer 值都会在插件设置时失败。

## 运行时、截图与生命周期

每次 spawn 都使用显式 stdin/stdout/stderr disposition，转发取消信号，应用 Provider deadline，并从子进程环境移除 `ORCA_PAIRING_CODE`、`ORCA_REMOTE_PAIRING` 和 `ORCA_ENVIRONMENT`。因此 Provider 选择本地 Cinlan runtime，而不会使用环境中的远程 pairing。

CLI `runtimeId` 是 generation 标记。generation 变化会清空全部观察；动作还会拒绝在 preflight 期间发现的 generation 变化。每个动作在发出输入前消费精确的旧观察，并发布一份新的动作后观察；陈旧 observation 和 element id 会在无关目标接收动作前失败。

截图可以是规范 base64，也可以是绝对、未过期的临时 PNG 路径。Provider 只接受非符号链接的普通文件，检查配置字节上限和稳定文件大小，验证 PNG signature，将字节返回 Consumer，并且不会在模型结果中暴露临时路径。

插件 disposal 会停止接受调用、取消并等待全部在途 CLI 进程、清空观察状态，最后注销 Provider。注册在清理完成前仍阻止独占的 Cua Driver 适配器启动。外部 Cinlan runtime 和桌面应用不属于 Provider 所有，仍会继续运行。

<a id="model-experience"></a>
## 模型体验

### Provider 支撑的桌面结果

#### 模型看到的内容

Provider 不直接贡献模型文本。[`@deepseek-ai/dsh-tool-computer-use`](../tool-computer-use/README.zh.md) 将已验证的应用、窗口、观察、动作和截图值转换为 `computer_*` 结果，并通过常规 error result 暴露 Provider、传输、超时、陈旧 runtime、陈旧 observation、陈旧 element 和协议失败。

#### Token 影响

CLI 执行与响应验证不增加请求 token；只有 Consumer 呈现的结果或错误会贡献模型可见 token。

#### KV Cache 影响

Runtime generation、session 命名空间和观察状态不会改变可复用请求前缀；prompt 与工具定义变化由 Consumer 配置负责。

## 已知限制与暂缓事项

- Provider 需要本地主机安装并可解析 Cinlan CLI，且其 `computer` 命令已认证并可用。
- Harness 测试使用确定性的 CLI fixture；本包本身不证明真实 UI Automation、macOS Accessibility、AT-SPI、compositor 或平台权限行为。
- Service Definition 会暴露能力发现，但设置阶段只要求应用与窗口列表；不受支持的动作家族会在执行时通过 CLI 失败。
- Provider 不提供远程 pairing、Execution Host 集成、显示服务器所有权、持久桌面 lease、Mobile Device、emulator、simulator、Speech/Audio 或 Browser 实现。

不发布 runtime invariant companion：Provider 注册、协议校验和 observation 新鲜度由各自操作执行，并由包级测试覆盖。

仅缓存成功的 executable 查询。安装或修复 PATH 后可重试失败的查询；调用方取消与插件卸载均会中止正在进行的查询。

### 开发备注

无。
