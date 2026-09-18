---
description: "通过官方 Remote 管理本机 Workspace Isolation 租约。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workspace-isolation

[English](README.md) | 中文

## 概述

此插件在 Web Settings 中添加仅限本机的 Workspace Isolation 页面。它列出权威的 active 与 hibernated lease，并通过生成的 `workspaceIsolation` Remote 命名空间提供 checkout inspection、受限改动审查、merge、cherry-pick、`.patch` export、activate、hibernate、安全 teardown、刷新与 orphan pruning。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

与 Settings、Locale 和官方 Remote assembly 一起挂载此插件。只有 `ctx.remote.$host.isLoopback` 为 true 时才注册该 section，因为其中的路径与 Git worktree 生命周期描述 Host 所在机器。

Merge、cherry-pick、teardown 与 orphan pruning 都要求显式确认。命令只发送 Provider 签发的 lease id；浏览器回调不接受 repository path、目标分支、删除路径或 force flag。安全 teardown 被拒绝时，hibernated lease 会携带 review marker 继续显示。被替代的读取与组件卸载会中止进行中的浏览器请求，过期响应不能覆盖更新的列表。

原生行沿用 Settings 父级内容宽度。本地化字段搜索覆盖租约记录、审查操作、孤儿清理与 Provider 策略说明，不索引路径、id、分支名或当前值。策略目标会展开说明。描述符和页面共享同一槽位注册生命周期。检查失败后提供重试；Host 尚未提供租约列表时禁用清理。

<a id="model-experience"></a>
## 模型体验

无，因为本包只贡献浏览器 UI，不注册 prompt、tool、Session event 或 model request input。

#### KV Cache 影响

无；租约管理不会改变模型请求。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

- 租约创建仍由 Session 与任务执行路径负责，而不是 Settings。
- Checkout 根目录与活动上限属于 Provider 配置。此页面没有隔离方式、执行主机、缓存共享或闲置超时的可写偏好消费者。
- 状态需要显式刷新；页面不订阅 Provider 生命周期事件。
- Active untracked 文件会被报告，但不会进入 patch preview 与 export。

<a id="dev-note"></a>
### 开发备注

组件只接收 typed locale 与生命周期回调。Cordis service 保留在注册模块中，Host controller 负责 Remote 错误分类。

不发布 runtime invariant companion，因为页面只保留组件局部交互状态，并在成功修改后重新读取 Provider 的权威投影。
