---
description: "漏洞知识库服务契约和提供方 runtime。"
kind: "package-reference"
---
# @deepseek-ai/dsh-vuln-kb-service

[English](README.md) | 中文

## 概述
本包定义漏洞知识库服务和将查询委托给当前提供方的 runtime。调用方可以按 CVE 或生态系统/包/版本查询，也可以读取单个 CVE 的完整详情。提供方选择保持显式，runtime 为工具和工作流消费者保持稳定的请求与结果类型。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
需要面向模型的漏洞查询时，挂载一个知识库提供方和 dsh-tool-vuln-kb。把上游网络策略留在提供方配置中。

<a id="model-experience"></a>
## 模型体验

间接通过拥有面向模型 schema 的漏洞查询消费者产生影响。

#### KV Cache 影响

无直接影响；知识库结果只有通过查询消费者才会进入模型上下文。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 服务不合并多个提供方，也不保证上游新鲜度。
- 提供方专属凭据和速率限制不属于本包。

不发布 runtime invariant companion，因为本包拥有服务契约，并委托可变提供方状态。

<a id="dev-note"></a>
### 开发备注

CVE id 和包坐标在服务边界保持为不透明类型化值。
