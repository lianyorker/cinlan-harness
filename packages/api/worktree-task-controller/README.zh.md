---
description: "用于本地 Worktree Task 生命周期操作的 Host Remote 控制器。"
kind: "package-reference"
---
# @deepseek-ai/dsh-api-worktree-task-controller

[English](README.md) | 中文

## 概述
本包通过类型化 Host Remote namespace 暴露 Worktree Task 生命周期操作。本地 Web 客户端可以使用不透明 task id 和结构化请求创建、列出、激活、hibernate、archive 及删除 task。控制器把 Git 与文件系统策略留给 ctx.worktreeTask，并拒绝浏览器提交的路径或命令。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
将控制器与 Typert Gateway 和 ctx.worktreeTask 提供方一起挂载。挂载 dsh-api-remotes 以提供浏览器 namespace。控制器保留取消语义，并把提供方失败映射为稳定的 Remote 错误码。

<a id="model-experience"></a>
## 模型体验

无，因为 Worktree Task Remote 控制器不注册 prompt、tool 或 Session event。

#### KV Cache 影响

无；task 管理不会改变模型请求。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- Task 创建和 checkout 限制由提供方配置决定。
- Remote 不流式传输 Git 子进程输出；调用方收到操作结果或类型化错误。

不发布 runtime invariant companion，因为控制器只是 Worktree Task 服务的无状态 Remote 投影。

<a id="dev-note"></a>
### 开发备注

Typert 会生成 Host 和 Remote 声明；请编辑 src/index.ts 和 src/types.ts，不要编辑生成文件。
