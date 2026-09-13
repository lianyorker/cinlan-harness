---
description: "用于持久类型化安全 Finding 和证据引用的 Session 提供方。"
kind: "package-reference"
---
# @deepseek-ai/dsh-finding-session

[English](README.md) | 中文

## 概述
本提供方在当前 Session 服务中存储类型化安全 Finding，并为查询和状态转换发布不可变快照。它去重规范 identity、执行 revision 检查、验证证据前置条件，并在状态变更前授权引用的 Artifact。它与 Finding 服务定义和 Finding 工具配合使用。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
与 Sessions、Agents、Finding 服务和 ArtifactService 提供方一起挂载。提供方从每次调用派生发起 Agent 和 Session，使 Finding 属于调用方，而不是全局进程 map。

<a id="model-experience"></a>
## 模型体验

间接通过拥有面向模型 schema 和结果渲染的 Finding 工具产生影响。

#### KV Cache 影响

无直接影响；Finding 快照只有在消费者查询时才会进入模型上下文。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- Finding 状态按挂载的 Session 持久化策略保留。
- Artifact 字节仍由配置的 ArtifactService 提供方负责。

不发布 runtime invariant companion，因为 Session Finding 流是本提供方使用的权威观察。

<a id="dev-note"></a>
### 开发备注

状态转换需要准确 Finding id 和 revision；reproduction 和 remediation 状态需要类型化证据。
