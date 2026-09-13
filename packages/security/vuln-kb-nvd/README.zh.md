---
description: "基于 NVD 的漏洞知识库提供方。"
kind: "package-reference"
---
# @deepseek-ai/dsh-vuln-kb-nvd

[English](README.md) | 中文

## 概述
本提供方从 NVD 服务获取漏洞条目，并将其适配到漏洞知识库契约。它通过 runtime 服务支持 CVE 读取和生态系统/包查询，同时保留有界结果字段和取消语义。安全 profile 具备 NVD 网络访问时使用它。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
与 dsh-vuln-kb-service 一起挂载，并配置 NVD endpoint 和请求限制。挂载 dsh-tool-vuln-kb，将服务暴露给模型。

<a id="model-experience"></a>
## 模型体验

间接通过拥有面向模型 schema 的漏洞查询消费者产生影响。

#### KV Cache 影响

无直接影响；只有消费者的漏洞结果才可能进入模型请求。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- NVD 的可用性、速率限制和响应新鲜度取决于上游服务。
- 提供方不会为目标或修复操作推断授权。

不发布 runtime invariant companion，因为提供方除了知识库服务外不拥有独立的可变投影。

<a id="dev-note"></a>
### 开发备注

在 profile 中明确保持网络访问和 endpoint 配置。
