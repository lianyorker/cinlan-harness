---
description: "面向本机 Workspace Isolation 租约管理的 Host Remote 控制器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-workspace-isolation-controller

[English](README.md) | 中文

## 概述

本包始终注册 Host 端 `workspaceIsolation` Remote 命名空间，同时把 `ctx.workspaceIsolation` 视为可选 Provider。本机 Web 客户端可以通过不透明 id 列出、检查、比较、集成、导出、激活、休眠、安全 teardown 或清理租约；任何命令都不接受文件系统路径、目标分支或 force flag。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

与 Typert Gateway 一起挂载此控制器。需要生命周期命令成功时再挂载 Workspace Isolation Provider；Provider 缺失时，每个方法返回 `workspace-isolation/unavailable`，而不是移除命名空间。

生成的 `./remote` contribution 由 `@deepseek-ai/dsh-api-remotes` 选择。响应逐字段生成分离 DTO。Inspection、comparison、integration、export 与 activation 会把调用方取消信号转发给 Provider；没有 Provider 取消参数的操作只在准入前检查该信号。安全 teardown 会投影 removal 或保留的 `review` lease。

<a id="model-experience"></a>
## 模型体验

无，因为这个 Host controller 不注册 prompt、tool、Session event 或 model request input。

#### KV Cache 影响

无；Remote 租约管理不会改变模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 此命名空间管理已有 Provider 租约；创建租约仍由 Session 与任务执行路径负责。
- 孤儿项发现范围仍受已挂载 Provider 的扫描策略约束。

<a id="dev-note"></a>
### 开发备注

Typert 会生成 `lib/typert.host.*` 与 `lib/typert.remote-client.*`；请修改 `src/index.ts` 与 `src/types.ts`，不要修改生成 artifact。

不发布 runtime invariant companion，因为此控制器不维护可变投影；每个响应都读取 Provider 的权威租约状态。
