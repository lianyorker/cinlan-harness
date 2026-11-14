---
description: "授权评估用的模型侧 ffuf 目录/参数 Fuzz 工具。"
kind: "package-reference"
---
# @cinlan/tool-ffuf

[English](README.md) | 中文

## 摘要
本包在 `ctx.tools` 上注册 `ffuf_fuzz` 工具。它通过 `ctx.subprocess` 调用本地安装的 `ffuf`，把 `-json` stdout 解析为有界的命中行（关键字、URL、状态码、长度），并始终附加 `-json -s`，默认开启 `-ac` 自动校准；不发出任何激进速率参数。授权由上游 `assessment-scope-tool-policy` 强制：Fuzz URL 的主机必须匹配当前 assessment-scope 授权声明的目标，且工具名必须出现在该策略的 `networkTools` 列表中。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
挂载 `@deepseek-ai/dsh-subprocess`（如 `dsh-subprocess-local` Provider）、`@deepseek-ai/dsh-tools`，以及配置了包含 `ffuf_fuzz` 的 `networkTools` 的 `@deepseek-ai/dsh-assessment-scope-tool-policy`。`ffuf` 可执行文件与作为参数传入的字典文件必须存在于执行主机上；工具对字典路径只做注入校验，不做存在性校验。

<a id="model-experience"></a>
## 模型体验

### ffuf_fuzz 工具模式

#### 模型看到什么

模型收到生成的 [`ffuf_fuzz` 模式](../../../docs/tool-catalog.zh.md#cinlantool-ffuf)：`url`（必填，必须包含字面 `FUZZ` 关键字，强制 http/https 协议）与 `wordlist`（必填文件路径），可选 `method`（`-X`）、`matchCodes`（`-mc`）、`autoCalibrate`（`-ac`，默认开）、`followRedirects`（`-r`）、`timeoutSeconds`（`-timeout`）。结果为命中行；渲染文本卡片只显示前 50 行。

#### Token 影响

该工具向模型工具上下文增加一条 Fuzz 描述和 JSON 模式；完整 JSON 结果受 `maxOutputBytes`（默认 256 KiB）字节上限约束。

#### KV 缓存影响

工具模式属于模型工具前缀，在已加载工具组合不变期间保持可缓存。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 需要本地安装足够新、支持 `-json` stdout 输出的 `ffuf`；可执行文件缺失时工具报出明确错误。
- 字典路径指向执行主机文件；路径校验只覆盖注入，不覆盖存在性与大小。
- 递归与多位置模式（`-recursion`、多关键字）未暴露；复杂多位置任务不在范围内。
- Fuzz 命中是攻击面测绘证据，不构成可利用性证明或授权凭据。

<a id="dev-note"></a>
### 开发备注

保持工具名 `ffuf_fuzz`、参数名 `url`/`wordlist` 与 `networkTools` 接线和 `assessment-scope-tool-policy` 及 security-research bundle patch 同步。
