---
description: "用于类型化安全 Finding、证据和 Finding 工具的可安装组合包。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-security-findings

[English](README.md) | 中文

## 概述
本组合包组合 Finding 服务、基于 Session 的 Finding 提供方、Artifact 契约和面向模型的 Finding 工具。它为 profile 提供完整的记录、查询、状态转换和导出路径，同时保留类型化证据前置条件与有范围的 Artifact 授权。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
通过 dsh profile 加载组合包，或将其 Loader 条目加入受控组合。使用 Finding 状态转换或导出前，提供 ArtifactService 和 Session 提供方。

<a id="model-experience"></a>
## 模型体验

间接通过此组合包插入的 Finding 工具产生影响。

#### KV Cache 影响

Finding 工具 schema 可能贡献稳定的模型工具前缀内容；组合包的提供方不添加 prompt 文本。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 组合包不授权目标，也不执行扫描器。
- Finding 持久化和 Artifact 保留取决于挂载的提供方。

不发布 runtime invariant companion，因为本组合包组合独立的提供方和消费者，不拥有单独的可变投影。

<a id="dev-note"></a>
### 开发备注

保持 Loader patch 为 insert 列表；Finding schema 变化后更新工具目录。
