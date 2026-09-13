---
description: "用于有范围安全证据和报告的进程内 Artifact 提供方。"
kind: "package-reference"
---
# @deepseek-ai/dsh-artifact-memory

[English](README.md) | 中文

## 概述
本提供方在进程内存中存储已发布的 Artifact 字节和引用。它从 ctx.executionHost 派生 execution-host provenance，计算 SHA-256 元数据，并在读取和写入时执行 session、task、engagement 与 scope 授权。它适用于可以接受重启丢失数据的本地 Web profile 和测试。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
在本提供方之前挂载 dsh-execution-host-local，并挂载 dsh-artifact 服务契约。消费者收到不可变引用；提供方在进程结束前保留对应字节。

<a id="model-experience"></a>
## 模型体验

无，因为内存 Artifact 提供方不注册 prompt、tool 或 Session event。

#### KV Cache 影响

无；证据存储不会改变模型请求。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- Host 重启会删除所有存储的字节和元数据。
- 提供方没有配额或后台垃圾回收器；部署 profile 必须通过消费者限制使用量。

不发布 runtime invariant companion，因为提供方的可变 map 完全由 ArtifactService 方法拥有，且没有独立的观察流。

<a id="dev-note"></a>
### 开发备注

提供方需要 executionHost 服务；provenance 不得接受调用方提供的 host id。
