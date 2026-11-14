---
description: "面向模型的 masscan SYN 限速扫描工具，用于已授权评估。"
kind: "package-reference"
---
# @cinlan/tool-masscan

[English](README.md) | 中文

## 摘要
本包在 `ctx.tools` 上注册 `masscan_scan` 工具。它通过 `ctx.subprocess` 调用本地安装的 `masscan` 二进制，把 `-oJ -` 流式 JSON（含被截断的数组）解析为有界的结构化开放端口行，并且从不发出文件输出、排除文件或列表文件参数。扫描速率同时受模型侧 `1..1000000` 校验与部署侧 `maxRate` 上限约束。授权由上游 `assessment-scope-tool-policy` 强制执行：`target_id` 必须匹配当前评估范围授权中声明的目标，且工具名必须出现在该策略的 `networkTools` 列表中。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发注记](#dev-note)

<a id="use-this-package"></a>
## 使用本包
挂载 `@deepseek-ai/dsh-subprocess`（例如 `dsh-subprocess-local` 这样的 Provider）、`@deepseek-ai/dsh-tools`，以及配置了包含 `masscan_scan` 的 `networkTools` 的 `@deepseek-ai/dsh-assessment-scope-tool-policy`。`masscan` 二进制必须能在执行主机 PATH 上解析，或通过 `config.command` 指定。将 `config.maxRate` 设为部署可接受的每秒发包上限；模型选择的 `rate` 不能超过它。

<a id="model-experience"></a>
## 模型体验

### masscan_scan 工具模式

#### 模型看到什么

模型收到生成的 [`masscan_scan` 模式](../../../docs/tool-catalog.zh.md#cinlantool-masscan)：`target_id`（必填，IP/CIDR/范围，须匹配授权目标）、可选 `ports`（`-p`，数字/逗号/连字符）、可选 `rate`（`--rate`，整数，默认 100，受 `maxRate` 约束）。

#### Token 影响

该工具向模型工具上下文追加一条扫描描述与 JSON 模式；结果按 `maxOutputBytes`（默认 256 KiB）做字节上限。

#### KV Cache 影响

工具模式属于模型工具前缀的一部分，在已加载工具组合不变期间保持可缓存。

## 已知限制与延后工作
<a id="known-limitations-and-deferred-work"></a>

- 需要本地安装 `masscan` 并具备原始套接字权限（多数平台需 root/管理员）；可执行文件缺失或扫描失败时工具会给出明确错误。
- `-oJ` 在运行被截断时输出不带收尾括号的 JSON 数组；解析器丢弃不完整的末尾对象，而不是上报可能被截断的端口号。
- 不做服务/版本探测：masscan 只发现开放端口，本工具刻意不暴露横幅抓取或脚本类标志。
- CIDR/范围目标必须逐字声明为授权目标值；范围策略做精确/前缀匹配，不做 CIDR 包含判断。
- 完成的扫描是分诊证据，不构成可利用性证明或授权授予。

<a id="dev-note"></a>
### 开发注记

保持工具名 `masscan_scan`、`target_id` 参数名、固定的 `-oJ -` 输出标志与 `networkTools` 接线同 `assessment-scope-tool-policy` 和 security-research bundle patch 同步。
