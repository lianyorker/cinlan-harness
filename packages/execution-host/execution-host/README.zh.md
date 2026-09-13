---
description: "用于 provenance 和评估授权的 execution-host identity 契约。"
kind: "package-reference"
---
# @deepseek-ai/dsh-execution-host

[English](README.md) | 中文

## 概述
本包定义 Artifact provenance 和评估授权使用的 execution-host identity。提供方返回一个包含 hostname、process、platform 和创建元数据的稳定 host id。消费者使用该 identity 将证据关联到产生它的进程，而不是信任浏览器提交的值。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
在发布证据或授权评估操作的组合中挂载一个 ExecutionHostService 提供方。在记录 provenance 或评估 host 授权的操作中读取 ctx.executionHost.current()。

<a id="model-experience"></a>
## 模型体验

无，因为 execution-host identity 服务不注册 prompt、tool 或 Session event。

#### KV Cache 影响

无；host identity 元数据不会改变模型请求。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 服务描述当前进程，不会对远程机器进行证明。
- Host identity 的生命周期和持久性由提供方决定。

不发布 runtime invariant companion，因为本包定义抽象服务且不拥有可变提供方状态。

<a id="dev-note"></a>
### 开发备注

ExecutionHostId 是不透明类型，必须在服务和 wire 边界保持品牌。
