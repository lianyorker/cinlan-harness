# Agent Note: Remote WebSocket 等待应用就绪

Status: implemented

[English](2026-09-23-gateway-waits-for-application-readiness.md) | 中文

## 问题

Web Host 在 profile 重启仍在挂载并审计控制器时会继续保持 HTTP listener。Gateway 在注入 `connection` 与 `webServer` 后立即注册 Remote WebSocket upgrade 路由，因此浏览器可能在应用就绪前重新打开载体，随后 Connection 只能尝试恢复一个 Host 服务尚未可用的流。

## 决策

Gateway 只有在 launcher 提供的 `ctx.appReady` 信号提交成功启动后，才注册 WebSocket upgrade 路由。未提供该可选信号的 Host 保留立即注册行为，以兼容自行负责启动顺序的嵌入式组合。进程内 Gateway 调用与流不依赖该信号。

就绪监听器由 effect 持有生命周期。Gateway dispose 时会取消尚未触发的监听器，并释放就绪后创建的 mux 及其活动 socket。并发 commit 可能持有已复制的监听器，但它受 closed 标记保护，不会在 dispose 后注册路由。

## 考虑过的替代方案

**保留始终注册的路由，在未就绪时拒绝 upgrade。** 这会让不安全期间仍存在 route 与 mux，只是把问题变成应用层 WebSocket 响应；延迟注册可以让 Connection 使用已有的载体重试策略。

**要求所有 Host 提供 readiness。** 嵌入式 Host 与测试可以自行负责启动顺序，把该服务设为必需会把超出 Gateway 传输契约的要求强加给它们。

**延迟整个 HTTP listener。** 普通 HTTP 页面与生命周期已经由 launcher 和 WebServer 拥有，只有 Remote 流准入需要该闸门；延迟 listener 会不必要地扩大重启行为。

## 后果

重启中的浏览器客户端在启动提交前可能看到 Remote 载体关闭或不可用，之后通过现有 Connection backoff 重新连接。任何 Remote 流都不会进入半初始化 Host。不提供 launcher readiness 服务的 Host 保留原行为，进程内传输在整个期间仍可用。完整输出超限后的载体清理由 [Gateway 输出上限 note](2026-09-25-gateway-complete-output-limit-teardown.zh.md) 单独规定。

## 测试

Gateway Host 测试验证：就绪未提交时 WebSocket 不被接受；提交后可接受；已就绪信号会立即注册；dispose 会移除监听器，迟到的 commit 也不会重新注册路由。
