# Agent Note: 桌面端同屏浏览器 CDP 集成

Status: implemented

[English](2026-09-29-desktop-co-screen-browser-cdp-integration.md) | 中文

## Problem

在 Cinlan Desktop 环境中操作的人类用户在侧边栏 webview 或持久化浏览器窗口中浏览页面，而自主 Browser Use Agent 需要 Chrome DevTools Protocol（CDP）调试端点来检查与操作网页。若桌面端 Electron 外壳缺少共享 CDP 调试开关，且核心浏览器运行时门面未做端点转发，Agent 便无法附着到桌面实时环境，阻碍人类与智能体共同观察并交互同一浏览器状态的同屏结对协作。

## Decision

在 `apps/desktop/src/browser-remote-debugging.ts` 中引入 `desktopRemoteDebuggingPort`，从 `DSH_DESKTOP_RENDERER_DEBUG_PORT`、`DSH_DESKTOP_CDP_PORT` 或 `CINLAN_DESKTOP_CDP_PORT` 解析已配置的 CDP 端口（校验范围为 1024 至 65535）。当配置了端口时，在 `apps/desktop/src/main.ts` 中配置 `app.commandLine.appendSwitch('remote-debugging-port', ...)`，并在开启远程调试时允许 `DesktopBrowserGuests` 进行 webview DevTools 检查。

扩展 `packages/browser/browser/src/index.ts` 中的 `BrowserRuntime` 服务定义，新增转发至当前活动 provider 的 `cdpEndpoint(): string | undefined` 门面方法。

在 `packages/bundle/cinlan-browser/tests/co-screen.spec.ts` 中新增端到端同屏集成测试套件，验证统一运行时启动、CDP 端口暴露、带 `--remote-debugging-port` 的持久上下文启动、模型工具执行及元素捕获共存。

## Alternatives considered

**为用户和 Agent 强制开启各自独立的隔离浏览器实例。** 开启相互独立的 Chromium 进程会浪费系统资源、使内存占用翻倍，并强迫用户在不同浏览器 profile 间重复进行身份认证。

**仅通过 Electron 主进程私有的 debugger webContents API 进行附着。** 采用专有 Electron 调试 API 会绕过标准 MCP 协议，导致 `@playwright/mcp` 或 Chrome DevTools MCP 等外部工具无法通过标准 WebSocket 端点连接。

**在桌面端启动逻辑中硬编码固定的调试端口。** 硬编码端口会在多个桌面实例或本地开发服务并发运行时引发端口占用冲突。

## Consequences

桌面端用户与自主 Agent 可以在已配置的 CDP 端口上共享实时浏览器会话。16 个原生持久化浏览器工具与外部 MCP Browser Use 提供方均可附着并操作该共享会话。

当环境中未配置调试端口时，继续保持标准环境隔离，不开放任何监听调试端口。

## Verification

`apps/desktop/tests/browser-remote-debugging.spec.ts` 覆盖端口解析优先级、空字符串及超限端口边界。`packages/browser/browser/tests/browser.spec.ts` 验证 `BrowserRuntime` 上的 `cdpEndpoint()` 转发。`packages/bundle/cinlan-browser/tests/co-screen.spec.ts` 验证携带完整 `cinlan-browser` bundle 的端到端同屏执行。
