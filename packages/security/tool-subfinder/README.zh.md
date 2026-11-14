---
description: "授权评估用的模型侧被动子域名枚举工具。"
kind: "package-reference"
---
# @cinlan/tool-subfinder

[English](README.md) | 中文

## 摘要
本包在 `ctx.tools` 上注册 `subfinder_enum` 工具。它通过 `ctx.subprocess` 调用本地安装的 `subfinder`，把 `-json` 输出解析为有界结构化行（主机名、数据来源、解析地址），且枚举完全被动：subfinder 查询第三方数据源与 DNS，不向目标自身服务发请求。授权由上游 `assessment-scope-tool-policy` 强制：`target_id` 域名必须匹配当前 assessment-scope 授权声明的目标，且工具名必须出现在该策略的 `networkTools` 列表中。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
挂载 `@deepseek-ai/dsh-subprocess`（如 `dsh-subprocess-local` Provider）、`@deepseek-ai/dsh-tools`，以及配置了包含 `subfinder_enum` 的 `networkTools` 的 `@deepseek-ai/dsh-assessment-scope-tool-policy`。`subfinder` 可执行文件必须在执行主机 PATH 上可解析，或通过 `config.command` 指定；被动数据源 API Key（如使用）来自 subfinder 自身的 Provider 配置。

<a id="model-experience"></a>
## 模型体验

### subfinder_enum 工具模式

#### 模型看到什么

模型收到生成的 [`subfinder_enum` 模式](../../../docs/tool-catalog.zh.md#cinlantool-subfinder)：`target_id`（必填，一个根域名，须匹配授权目标），可选 `resolve`（`-resolve`）与 `active`（`-active`）。结果为去重后的子域名行；渲染文本卡片只显示前 50 行。

#### Token 影响

该工具向模型工具上下文增加一条枚举描述和 JSON 模式；完整 JSON 结果受 `maxOutputBytes`（默认 256 KiB）字节上限约束。

#### KV 缓存影响

工具模式属于模型工具前缀，在已加载工具组合不变期间保持可缓存。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 需要本地安装 `subfinder`；可执行文件缺失时工具报出明确错误。
- 覆盖面取决于所配置的被动数据源；不保证枚举完整性。
- 子进程 stdout 在解析前上限 32 MiB；超限截断可能丢失行。
- 完成的枚举是攻击面测绘证据，不证明发现的主机在授权范围内；后续工具使用前须逐主机对照授权校验。

<a id="dev-note"></a>
### 开发备注

保持工具名 `subfinder_enum`、参数名 `target_id` 与 `networkTools` 接线和 `assessment-scope-tool-policy` 及 security-research bundle patch 同步。
