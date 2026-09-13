---
description: "用于 Worktree Task 生命周期管理的 Web Settings 页面。"
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-worktree-task

[English](README.md) | 中文

## 概述
当 Host 暴露官方 Remote namespace 时，本浏览器插件向 Web Settings 添加 Worktree Task 分区。它列出 task 记录、刷新权威状态、激活和 hibernate task，并报告类型化提供方错误；页面不接受文件系统路径或 shell 命令。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
将插件与 locale、Settings 和 Remote 组合一起挂载。页面只在 loopback Host 上启用，并向 dsh-api-worktree-task-controller 发送不透明 task id。

<a id="model-experience"></a>
## 模型体验

无，因为浏览器 Worktree Task Settings 页面不注册 prompt、tool 或 Session event。

#### KV Cache 影响

无；task 管理不会改变模型请求。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- Task 创建和 checkout 配置由 Host/提供方负责。
- 页面使用显式刷新，不订阅 task 生命周期事件。

不发布 runtime invariant companion，因为页面只保留组件本地交互状态，并重新加载权威 Remote 结果。

<a id="dev-note"></a>
### 开发备注

Cordis 服务留在注册模块中，并将类型化 locale 和回调传入组件。
