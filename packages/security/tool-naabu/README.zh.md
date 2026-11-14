---
description: "授权评估用的模型侧 naabu 快速端口扫描工具。"
kind: "package-reference"
---
# @cinlan/tool-naabu

[English](README.md) | 中文

## 摘要
本包在 `ctx.tools` 上注册 `naabu_scan` 工具。它通过 `ctx.subprocess` 调用本地安装的 `naabu`，把 `-json` 输出解析为有界结构化开放端口行（主机、IP、端口），并始终附加 `-silent -exclude-cdn`。服务识别不在范围内——工具只发现开放端口。授权由上游 `assessment-scope-tool-policy` 强制：`target_id` 必须匹配当前 assessment-scope 授权声明的目标，且工具名必须出现在该策略的 `networkTools` 列表中。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
挂载 `@deepseek-ai/dsh-subprocess`（如 `dsh-subprocess-local` Provider）、`@deepseek-ai/dsh-tools`，以及配置了包含 `naabu_scan` 的 `networkTools` 的 `@deepseek-ai/dsh-assessment-scope-tool-policy`。`naabu` 可执行文件必须在执行主机 PATH 上可解析，或通过 `config.command` 指定；SYN 扫描在多数平台需要提升权限。

<a id="model-experience"></a>
## 模型体验

### naabu_scan 工具模式

#### 模型看到什么

模型收到生成的 [`naabu_scan` 模式](../../../docs/tool-catalog.zh.md#cinlantool-naabu)：`target_id`（必填，空白/逗号分隔的目标，须匹配授权目标，至多 1000 个），加 `ports`（`-p`）或 `topPorts`（`-top-ports`），二者互斥。结果为开放端口行；渲染文本卡片只显示前 50 行。

#### Token 影响

该工具向模型工具上下文增加一条扫描描述和 JSON 模式；完整 JSON 结果受 `maxOutputBytes`（默认 256 KiB）字节上限约束。

#### KV 缓存影响

工具模式属于模型工具前缀，在已加载工具组合不变期间保持可缓存。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 需要本地安装 `naabu`；可执行文件缺失时工具报出明确错误。
- 不做服务/版本指纹识别：需要服务名时配合 `nmap_scan -sV`。
- SYN 扫描在多数平台需要提升权限；connect 模式回退行为由 naabu 自身决定。
- CIDR 目标必须按授权目标原样声明；scope 策略做精确/前缀匹配，不做 CIDR 包含判断。
- 完成的扫描是分诊证据，不构成可利用性证明或授权凭据。

<a id="dev-note"></a>
### 开发备注

保持工具名 `naabu_scan`、参数名 `target_id` 与 `networkTools` 接线和 `assessment-scope-tool-policy` 及 security-research bundle patch 同步。
