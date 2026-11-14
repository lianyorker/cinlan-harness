---
description: "面向模型的被动已知 URL 获取工具，用于已授权评估。"
kind: "package-reference"
---
# @cinlan/tool-gau

[English](README.md) | 中文

## 摘要
本包在 `ctx.tools` 上注册 `gau_urls` 工具。它通过 `ctx.subprocess` 以固定的 `--json --subs` 标志调用本地安装的 `gau` 二进制，把 JSON 记录/纯文本行混合输出解析为有界的去重 URL 行，并且从不发出输出文件参数。运行完全被动：gau 查询第三方历史档案（wayback、commoncrawl、otx、urlscan），从不接触目标域名本身。授权由上游 `assessment-scope-tool-policy` 强制执行：`target_id` 必须匹配当前评估范围授权中声明的域名，且工具名必须出现在该策略的 `networkTools` 列表中。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发注记](#dev-note)

<a id="use-this-package"></a>
## 使用本包
挂载 `@deepseek-ai/dsh-subprocess`（例如 `dsh-subprocess-local` 这样的 Provider）、`@deepseek-ai/dsh-tools`，以及配置了包含 `gau_urls` 的 `networkTools` 的 `@deepseek-ai/dsh-assessment-scope-tool-policy`。`gau` 二进制必须能在执行主机 PATH 上解析，或通过 `config.command` 指定。

<a id="model-experience"></a>
## 模型体验

### gau_urls 工具模式

#### 模型看到什么

模型收到生成的 [`gau_urls` 模式](../../../docs/tool-catalog.zh.md#cinlantool-gau)：`target_id`（必填域名，须匹配授权目标）、可选 `providers`（`wayback`、`commoncrawl`、`otx`、`urlscan` 的子集；省略表示全部来源）。

#### Token 影响

该工具向模型工具上下文追加一条获取描述与 JSON 模式；结果按 `maxOutputBytes`（默认 256 KiB）做字节上限。

#### KV Cache 影响

工具模式属于模型工具前缀的一部分，在已加载工具组合不变期间保持可缓存。

## 已知限制与延后工作
<a id="known-limitations-and-deferred-work"></a>

- 需要本地安装 `gau`；可执行文件缺失时工具会给出明确错误。
- `--json` 输出形状随 gau 版本变化（JSON 记录或纯 URL 行）；解析器两种都接受，但无法识别 `url` 字段之外的记录元数据。
- 档案 URL 是历史数据：可能已过期、已下线或不再是授权表面——把结果当作需按当前授权重新核实的线索，绝不当作可直接打的目标。
- 大域名的结果量可能很大；工具在 50 行处截断渲染，并按 `maxOutputBytes` 约束序列化结果。

<a id="dev-note"></a>
### 开发注记

保持工具名 `gau_urls`、`target_id` 参数名、固定的 `--json --subs` 标志、Provider 白名单与 `networkTools` 接线同 `assessment-scope-tool-policy` 和 security-research bundle patch 同步。
