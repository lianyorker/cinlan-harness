---
description: "授权评估用的模型侧 httpx Web 服务探测工具。"
kind: "package-reference"
---
# @cinlan/tool-httpx

[English](README.md) | 中文

## 摘要
本包在 `ctx.tools` 上注册 `httpx_probe` 工具。它通过 `ctx.subprocess` 调用本地安装的 `httpx`，把 `-json` 输出解析为有界结构化行（URL、状态码、标题、技术栈、Web 服务器、CDN），并始终附加 `-no-color -silent`。授权由上游 `assessment-scope-tool-policy` 强制：`target_id` 必须匹配当前 assessment-scope 授权声明的目标，且工具名必须出现在该策略的 `networkTools` 列表中。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
挂载 `@deepseek-ai/dsh-subprocess`（如 `dsh-subprocess-local` Provider）、`@deepseek-ai/dsh-tools`，以及配置了包含 `httpx_probe` 的 `networkTools` 的 `@deepseek-ai/dsh-assessment-scope-tool-policy`。`httpx` 可执行文件必须在执行主机 PATH 上可解析，或通过 `config.command` 指定。

<a id="model-experience"></a>
## 模型体验

### httpx_probe 工具模式

#### 模型看到什么

模型收到生成的 [`httpx_probe` 模式](../../../docs/tool-catalog.zh.md#cinlantool-httpx)：`target_id`（必填，空白/逗号分隔的目标，须匹配授权目标，至多 1000 个），可选 `statusCode`、`title`、`techDetect`、`followRedirects`、`https`、`http` 协议开关。结果为存活服务行；渲染文本卡片只显示前 50 行。

#### Token 影响

该工具向模型工具上下文增加一条探测描述和 JSON 模式；完整 JSON 结果受 `maxOutputBytes`（默认 256 KiB）字节上限约束。

#### KV 缓存影响

工具模式属于模型工具前缀，在已加载工具组合不变期间保持可缓存。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 需要本地安装 `httpx`；可执行文件缺失时工具报出明确错误。
- 不做 fuzz 或 payload 注入：工具只探测存活与元信息。
- 子进程 stdout 在解析前上限 32 MiB；超限截断可能丢失行。
- 完成的探测是分诊证据，不构成可利用性证明或授权凭据。

<a id="dev-note"></a>
### 开发备注

保持工具名 `httpx_probe`、参数名 `target_id` 与 `networkTools` 接线和 `assessment-scope-tool-policy` 及 security-research bundle patch 同步。
