---
description: "面向模型的 BloodHound 目录收集工具，用于已授权评估。"
kind: "package-reference"
---
# @cinlan/tool-bloodhound

[English](README.md) | 中文

## 摘要
本包在 `ctx.tools` 上注册 `bloodhound_enum` 工具。它通过 `ctx.subprocess` 调用本地安装的 `bloodhound-python` 二进制，在私有临时目录中收集，把收集器 JSON 聚合为分诊摘要（各收集器行数 + 可 Kerberoast 与可 AS-REP Roast 的账户清单），随后删除该目录。账户密码在执行期经 `ctx.get('credentials')` 从模型提供的 `credential_ref` 解析，绝不进入模型可见参数、工具结果或会话日志。授权由上游 `assessment-scope-tool-policy` 按 `credential-use` 动作强制执行。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发注记](#dev-note)

<a id="use-this-package"></a>
## 使用本包
挂载 `@deepseek-ai/dsh-subprocess`（例如 `dsh-subprocess-local`）、`@deepseek-ai/dsh-tools`、一个凭据 Provider（例如 `@deepseek-ai/dsh-credentials-local`），以及配置了包含 `bloodhound_enum` 的 `credentialTools` 的 `@deepseek-ai/dsh-assessment-scope-tool-policy`。`bloodhound-python` 可执行文件必须能在执行主机 PATH 上解析，或通过 `config.command` 指定。授权必须声明 `credential-use` 动作，并为被收集域声明与所呈引用配对的 `credentials` 条目。

<a id="model-experience"></a>
## 模型体验

### bloodhound_enum 工具模式

#### 模型看到什么

模型收到生成的 [`bloodhound_enum` 模式](../../../docs/tool-catalog.zh.md#cinlantool-bloodhound)：`target_id`（必填域名，须匹配授权目标）、`username`（必填）、`credential_ref`（必填，env-var 语法的名字——其值绝不进入对话）、可选 `nameserver`（`-ns`）。

#### Token 影响

该工具向模型工具上下文追加一条描述与 JSON 模式；结果按 `maxOutputBytes`（默认 256 KiB）做字节上限。

#### KV Cache 影响

工具模式属于模型工具前缀的一部分，在已加载工具组合不变期间保持可缓存。

## 已知限制与延后工作
<a id="known-limitations-and-deferred-work"></a>

- 需要本地安装 `bloodhound-python`；可执行文件缺失时工具会给出明确错误。
- 摘要从 `users.json` 提取各收集器计数与可 Roast 账户清单；它是分诊视图而非图查询接口——完整攻击路径图留在收集器 JSON 中，本工具聚合后即删除。
- bloodhound-python 输出形状随版本变化；聚合器同时接受纯数组与 `{"data": [...]}` 两种文档形状，并跳过无法解析的文件。
- 密码随 `-p` 标志传递，执行期间在本机进程列表可见——但绝不进入模型可见参数、结果或会话日志。
- 这些调用不构造 egress；授权依赖目标、`credential-use` 动作与已授权凭据引用三者共同把关。

<a id="dev-note"></a>
### 开发注记

保持工具名 `bloodhound_enum`、`credential_ref` 参数名与 `credentialTools` 接线同 `assessment-scope-tool-policy` 和 security-research bundle patch 同步。
