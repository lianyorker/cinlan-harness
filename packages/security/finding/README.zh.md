---
description: "类型化安全 Finding 模型、证据规则和生命周期服务契约。"
kind: "package-reference"
---
# @deepseek-ai/dsh-finding

[English](README.md) | 中文

## 概述
本包定义持久安全 Finding 及其生命周期状态。Finding identity 由 rule、targets 和 locations 组成；revision 保护状态转换；evidence 和 reachability 字段区分 observation、reproduced vulnerability 和 remediation。提供方负责持久化，工具负责面向模型的访问。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
与 dsh-finding-session 或其他提供方一起挂载服务。使用类型化证据执行 reproduction 和 remediation 状态转换，并让 Artifact 授权与 Finding scope 保持一致。

<a id="model-experience"></a>
## 模型体验

间接通过拥有面向模型 schema 和结果渲染的 Finding 工具产生影响。

#### KV Cache 影响

无直接影响；Finding 状态只有在消费者查询或导出时才会进入模型上下文。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 服务本身不复现漏洞，也不验证扫描器声明。
- Artifact 保留和存储持久性由提供方负责。

不发布 runtime invariant companion，因为本包定义 Finding 服务契约，不拥有持久化投影。

<a id="dev-note"></a>
### 开发备注

状态转换需要准确 revision 和类型化前置证据；重复 identity 增加 occurrence，不创建重复条目。
