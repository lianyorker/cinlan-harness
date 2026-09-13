---
description: "用于漏洞知识库服务、提供方和工具的可安装组合包。"
kind: "package-bundle"
---
# @deepseek-ai/dsh-vuln-kb

[English](README.md) | 中文

## 概述
本组合包组合漏洞知识库服务、提供方适配器和面向模型的查询工具。Profile 可以通过一个类型化 namespace 查询 CVE 和包坐标，同时把上游网络策略与新鲜度留给选定的提供方。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
使用 NVD 等提供方和核心工具 registry 加载组合包。在 profile 中显式配置网络访问和请求限制。

<a id="model-experience"></a>
## 模型体验

间接通过此组合包插入的漏洞查询工具产生影响。

#### KV Cache 影响

工具 schema 可能贡献稳定的模型工具前缀内容；提供方数据只有在查询后才进入请求。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 上游可用性、速率限制和新鲜度由提供方负责。
- 知识库结果不证明可利用性，也不授权修复操作。

不发布 runtime invariant companion，因为组合包只组合服务和消费者，不拥有单独的可变投影。

<a id="dev-note"></a>
### 开发备注

保持 Loader 根为 entry array；schema 变化后重新生成工具目录。
