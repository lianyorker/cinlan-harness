---
description: "授权评估用的模型侧 nuclei 模板化漏洞扫描工具。"
kind: "package-reference"
---
# @cinlan/tool-nuclei

[English](README.md) | 中文

## 摘要
本包在 `ctx.tools` 上注册 `nuclei_scan` 工具。它通过 `ctx.subprocess` 调用本地安装的 `nuclei`，把 `-json` 输出解析为有界的发现行（模板、严重级别、命中 URL），并始终附加 `-json -silent -no-color -ni`：无颜色、无 interactsh 带外回调，且从不发出 `-dast` 或 payload 变异类参数。授权由上游 `assessment-scope-tool-policy` 强制：`target_id` 必须匹配当前 assessment-scope 授权声明的目标，且工具名必须出现在该策略的 `networkTools` 列表中。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
挂载 `@deepseek-ai/dsh-subprocess`（如 `dsh-subprocess-local` Provider）、`@deepseek-ai/dsh-tools`，以及配置了包含 `nuclei_scan` 的 `networkTools` 的 `@deepseek-ai/dsh-assessment-scope-tool-policy`。`nuclei` 可执行文件与引用的本地模板目录必须在执行主机上可解析；模板更新由 nuclei 自身缓存管理。

<a id="model-experience"></a>
## 模型体验

### nuclei_scan 工具模式

#### 模型看到什么

模型收到生成的 [`nuclei_scan` 模式](../../../docs/tool-catalog.zh.md#cinlantool-nuclei)：`target_id`（必填，空白/逗号分隔的 URL 或裸主机，须匹配授权目标，至多 100 个），可选 `templates`（`-t`）、`severities`（`-severity`，info..critical）、`followRedirects`、`timeoutSeconds`（`-timeout`）。结果为发现行；渲染文本卡片只显示前 50 行。

#### Token 影响

该工具向模型工具上下文增加一条扫描描述和 JSON 模式；完整 JSON 结果受 `maxOutputBytes`（默认 256 KiB）字节上限约束。

#### KV 缓存影响

工具模式属于模型工具前缀，在已加载工具组合不变期间保持可缓存。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 需要本地安装 `nuclei`；可执行文件缺失时工具报出明确错误。
- 模板覆盖面取决于本地 nuclei 模板缓存；本工具不触发模板更新。
- 带外（interactsh）发现默认关闭；需要 OOB 回调的盲洞验证需要显式出口决策，不在本工具范围内。
- 模板命中是分诊证据，不构成可利用性证明或授权凭据。

<a id="dev-note"></a>
### 开发备注

保持工具名 `nuclei_scan`、参数名 `target_id` 与 `networkTools` 接线和 `assessment-scope-tool-policy` 及 security-research bundle patch 同步。
