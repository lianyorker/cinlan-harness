# Agent Note: Browser Playwright CDP 桥接支持 Browser Use

Status: implemented

[English](2026-09-29-browser-playwright-cdp-bridge-for-browser-use.md) | 中文

## Problem

持久化浏览器提供方（`dsh-browser-playwright`）在隔离的内部上下文中启动 Chromium 实例，导致处于 `mode: attach` 模式的模型驱动 Browser Use 提供方（`browser-use-playwright-mcp` 或 `browser-use-chrome-devtools-mcp`）无法发现或附着到已打开的桌面端浏览器会话。缺少共享调试端点时，Agent 操作已有标签页被迫启动独立的第二个浏览器，既重复消耗系统资源又丢失了用户的实时登录态。

## Decision

扩展 `BrowserProvider` 能力接口，新增可选的 `cdpEndpoint?(): string | undefined` 方法。`dsh-browser-playwright` 提供方引入可选配置项 `remoteDebuggingPort`（校验 TCP 端口范围为 1024 到 65535，并支持通过 `DSH_BROWSER_CDP_PORT` 或 `CINLAN_BROWSER_CDP_PORT` 环境变量后备）。

当配置了 `remoteDebuggingPort` 时，Chromium 启动时会带上 `--remote-debugging-port=<port>` 参数，且 `cdpEndpoint()` 返回 `http://127.0.0.1:<port>`。配置为 `mode: attach` 的 Browser Use Agent 可以直接连接该端点，与桌面端用户操作协同检查并操控页面。

此外，更新 `@deepseek-ai/dsh-experimental-browser-use-runtime` 的包元数据，显式声明 `@deepseek-ai/dsh-mcp-client` 与 `@deepseek-ai/dsh-scope` 的 workspace peerDependencies，同时清理不再引用的历史遗留依赖 `@deepseek-ai/dsh-code-runtime`。

## Alternatives considered

**专门为 Browser Use 启动第二个浏览器进程。** 启动独立实例会导致 Agent 无法复用用户现有的认证登录状态，并增加系统内存开销。

**从 Chromium stderr 动态解析并分配临时 CDP 端口。** 解析 stderr 增加了进程异步绑定的复杂性，且在沙箱执行或重定向/屏蔽标准输出输出流时容易失效。

**直接暴露原始 Chromium WebSocket 调试 URL 而非 HTTP 端点。** WebSocket URL 包含进程重启时变动的页面 GUID，而本地 HTTP CDP 端点为 MCP attach 启动器提供了稳定的端点寻址。

## Consequences

配置 `remoteDebuggingPort` 后，携带 `browser-use-playwright-mcp` 的活跃 Session 可直接附着到持久化 Playwright 浏览器。除非显式配置，浏览器提供方默认仍保持无头模式。

若未配置端口或环境变量，则不会开启调试端口，`cdpEndpoint()` 返回 `undefined`，保持标准执行 profile 的环境隔离。

## Verification

`packages/browser/browser-playwright/tests/provider.spec.ts` 验证了有效和无效的 `remoteDebuggingPort` 端口范围校验、携带 `--remote-debugging-port` 的启动参数以及 `cdpEndpoint()` 返回值，保持语句、分支、函数与行覆盖率 100%。`packages/experimental/browser-use-runtime/tests` 验证了完整的 Session 资源获取与 MCP 客户端挂载。
