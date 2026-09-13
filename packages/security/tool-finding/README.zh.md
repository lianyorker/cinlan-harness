---
description: "用于记录、查询、转换和导出安全 Finding 的面向模型工具。"
kind: "package-reference"
---
# @deepseek-ai/dsh-tool-finding

[English](README.md) | 中文

## 概述
本插件注册 finding_record、finding_query、finding_transition 和 finding_export。工具暴露类型化 Finding identity、有范围的证据、生命周期前置条件以及 SARIF、Markdown 或 JSON 报告导出，并将持久化和 Artifact 授权委托给当前 Finding 与 ArtifactService 提供方。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
与 dsh-finding、dsh-finding-session、dsh-artifact、dsh-artifact-local 和核心工具 registry 一起挂载。在允许 finding_export 模型调用前配置 assessment-scope-session 与 report-download 操作；其他 Finding 调用仍遵循各自的证据前置条件。

JSON 与 Markdown 报告时间戳取自最新 Finding 更新时间；空报告使用 Unix epoch。SARIF 不包含当前时钟时间戳。

<a id="model-experience"></a>
## 模型体验

### Finding 工具 schema

#### What the model sees

模型会收到工具目录中记录的四个 Finding 工具 schema，见[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-finding)。

#### Token effect

插件向模型工具上下文添加 Finding 操作描述和 JSON schema。

#### KV Cache effect

工具 schema 属于模型工具前缀，直到加载的工具组合变化前可以保持缓存。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 工具调用会记录或转换 Finding，但不会独立证明可利用性。
- 导出字节通过 ArtifactService 发布，不嵌入工具结果。挂载 assessment-scope-session 时，`finding_export` 必须为每个 Finding 目标取得 report-download；缺少范围会拒绝导出。

不发布 runtime invariant companion，因为插件注册工具 schema，并把可变状态委托给 Finding 和 Artifact 服务。

<a id="dev-note"></a>
### 开发备注

reproduction 和 remediation 状态转换需要类型化证据；schema 变化后保持工具目录同步。
