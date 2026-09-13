---
description: "用于 Artifact provenance 的本地进程 execution-host 提供方。"
kind: "package-reference"
---
# @deepseek-ai/dsh-execution-host-local

[English](README.md) | 中文

## 概述
本提供方为当前本地进程创建一个 execution-host identity。它记录生成的 opaque id、hostname、PID、platform 和创建时间，并通过 ctx.executionHost 提供不可变记录。它适用于需要真实证据 provenance 但没有外部证明的本地 profile。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
将提供方作为 executionHost 实现挂载在 Artifact 和评估消费者之前。提供方没有配置，并在其 Cordis 服务生命周期内返回同一条记录。

<a id="model-experience"></a>
## 模型体验

无，因为本地 execution-host 提供方不注册 prompt、tool 或 Session event。

#### KV Cache 影响

无；本地主机元数据不会改变模型请求。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 生成的 id 只在进程内有效，不是持久机器 identity。
- 远程 Host 需要实现 execution-host 服务的其他提供方。

不发布 runtime invariant companion，因为提供方拥有一条不可变 identity 记录且没有分歧观察。

<a id="dev-note"></a>
### 开发备注

提供方内部派生 host id；调用方不能配置或覆盖它。
