---
description: "面向模型的 katana URL 爬取工具，用于已授权评估。"
kind: "package-reference"
---
# @cinlan/tool-katana

[English](README.md) | 中文

## 摘要
本包在 `ctx.tools` 上注册 `katana_crawl` 工具。它通过 `ctx.subprocess` 以固定的 `-json -silent -no-color` 输出标志调用本地安装的 `katana` 二进制，把行式 JSON 解析为有界的结构化发现行，并且从不发出输出文件、排除文件或带外回调参数。深度限制在 `1..5`，并发受部署侧 `maxConcurrency` 上限约束。授权由上游 `assessment-scope-tool-policy` 强制执行：`target_id` URL 主机必须匹配当前评估范围授权中声明的目标，且工具名必须出现在该策略的 `networkTools` 列表中。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发注记](#dev-note)

<a id="use-this-package"></a>
## 使用本包
挂载 `@deepseek-ai/dsh-subprocess`（例如 `dsh-subprocess-local` 这样的 Provider）、`@deepseek-ai/dsh-tools`，以及配置了包含 `katana_crawl` 的 `networkTools` 的 `@deepseek-ai/dsh-assessment-scope-tool-policy`。`katana` 二进制必须能在执行主机 PATH 上解析，或通过 `config.command` 指定。将 `config.maxConcurrency` 设为部署可接受的工作并发上限；模型选择的 `concurrency` 不能超过它。

<a id="model-experience"></a>
## 模型体验

### katana_crawl 工具模式

#### 模型看到什么

模型收到生成的 [`katana_crawl` 模式](../../../docs/tool-catalog.zh.md#cinlantool-katana)：`target_id`（必填，绝对 http(s) URL，主机须匹配授权目标）、可选 `depth`（`-d`，1..5，默认 3）、可选 `concurrency`（`-c`，受 `maxConcurrency` 约束）。

#### Token 影响

该工具向模型工具上下文追加一条爬取描述与 JSON 模式；结果按 `maxOutputBytes`（默认 256 KiB）做字节上限。

#### KV Cache 影响

工具模式属于模型工具前缀的一部分，在已加载工具组合不变期间保持可缓存。

## 已知限制与延后工作
<a id="known-limitations-and-deferred-work"></a>

- 需要本地安装 `katana`；可执行文件缺失时工具会给出明确错误。
- 爬取器会主动请求被授权主机：范围策略授权的是 URL 主机，爬取保持在目标表面上，但 katana 自身可能在过滤前请求动态发现的跨主机 URL——授权该主机时需考虑这一点。
- 不暴露载荷或利用类标志；这是发现型爬取器，不是 DAST 扫描器。
- JavaScript 渲染发现取决于所装 katana 构建的运行时支持；本包不挂载浏览器。

<a id="dev-note"></a>
### 开发注记

保持工具名 `katana_crawl`、`target_id` 参数名、固定的 `-json -silent -no-color` 输出标志与 `networkTools` 接线同 `assessment-scope-tool-policy` 和 security-research bundle patch 同步。
