---
description: "面向模型的漏洞知识库查询工具。"
kind: "package-reference"
---
# @deepseek-ai/dsh-tool-vuln-kb

[English](README.md) | 中文

## 概述
本插件暴露由当前知识库服务支持的有界漏洞查询工具。模型可以按 CVE 或包坐标查询并读取单个 CVE 详情；提供方错误和结果限制保持类型化。插件不授权评估操作，也不声称匹配的漏洞可被利用。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
与 dsh-vuln-kb-service、dsh-vuln-kb-nvd 等提供方和核心工具 registry 一起挂载。生成的工具 schema 是参数和结果字段的事实来源。

<a id="model-experience"></a>
## 模型体验

### 漏洞查询工具 schema

#### What the model sees

模型会收到工具目录中记录的查询和读取 schema，见[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-vuln-kb)。

#### Token effect

插件向模型工具上下文添加漏洞查询和读取的描述及 JSON schema。

#### KV Cache effect

工具 schema 属于模型工具前缀，直到加载的工具组合变化前可以保持缓存。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 结果取决于当前提供方和上游知识库的新鲜度。
- 查询结果是分类阶段的证据，不是授权 grant，也不是可利用性证明。

不发布 runtime invariant companion，因为工具插件注册 schema，并把状态委托给知识库服务。

<a id="dev-note"></a>
### 开发备注

保持工具名称和 schema 限制与生成的工具目录同步。
