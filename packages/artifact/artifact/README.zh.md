---
description: "用于证据和报告的类型化 Artifact 元数据与授权契约。"
kind: "package-reference"
---
# @deepseek-ai/dsh-artifact

[English](README.md) | 中文

## 概述
本包定义安全证据、报告和录制内容使用的 Artifact 引用。生产方发布带有不可变媒体、provenance、保留期限和 redaction 元数据的字节；调用方使用带品牌的标识符授权有范围的读取和写入。提供方选择存储与保留行为，但不能改变元数据契约。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
当 finding 或其他消费者发布证据时挂载 ArtifactService 提供方。使用带品牌的 provenance 标识符，并传入与 Artifact scope 匹配的授权字段。服务定义不依赖具体提供方，也不自行存储字节。

<a id="model-experience"></a>
## 模型体验

无，因为 Artifact 服务定义元数据且不注册 prompt、tool 或 Session event。

#### KV Cache 影响

无；Artifact 元数据不会改变模型请求。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 存储持久性、垃圾回收和字节访问由提供方负责。
- 授权覆盖声明的 session、task、engagement 和 scope 引用；host identity 是 provenance，不是调用方授权。

不发布 runtime invariant companion，因为本包声明服务契约且不拥有可变的提供方状态。

<a id="dev-note"></a>
### 开发备注

公共类型位于 src/types.ts；提供方必须保留不可变的 ArtifactRef 元数据和授权语义。
