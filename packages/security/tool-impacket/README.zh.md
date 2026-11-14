---
description: "面向模型的 impacket 域凭据工具，用于已授权评估。"
kind: "package-reference"
---
# @cinlan/tool-impacket

[English](README.md) | 中文

## 摘要
本包在 `ctx.tools` 上注册 `kerberoast`、`asrep_roast` 与 `secrets_dump` 三个工具。每个工具通过 `ctx.subprocess` 调用本地安装的 impacket 二进制，并把 hash 或凭据行解析为有界的结构化输出。账户密码在执行期经 `ctx.get('credentials')` 从模型提供的 `credential_ref` 解析，绝不进入模型可见参数、工具结果或会话日志。授权由上游 `assessment-scope-tool-policy` 强制执行：工具名必须列入该策略的 `credentialTools`，调用必须携带格式合法的 `credential_ref`，`target_id` 必须匹配授权目标，且映射的 `credential-use` 动作必须为该目标授予该凭据引用。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发注记](#dev-note)

<a id="use-this-package"></a>
## 使用本包
挂载 `@deepseek-ai/dsh-subprocess`（例如 `dsh-subprocess-local`）、`@deepseek-ai/dsh-tools`、一个凭据 Provider（例如 `@deepseek-ai/dsh-credentials-local`），以及配置了包含三个工具名的 `credentialTools` 的 `@deepseek-ai/dsh-assessment-scope-tool-policy`。impacket 可执行文件必须能在执行主机 PATH 上解析，或通过各工具的 config 命令（`keroboastCommand`、`asreproastCommand`、`secretsdumpCommand`）指定。授权必须声明 `credential-use` 动作，并为每个喷洒/转储目标声明与所呈引用配对的 `credentials` 条目。

<a id="model-experience"></a>
## 模型体验

### keroboast、asrep_roast 与 secrets_dump 工具模式

#### 模型看到什么

模型收到生成的 [`keroboast` 模式](../../../docs/tool-catalog.zh.md#cinlantool-impacket)（以及同包的 `asrep_roast`/`secrets_dump` 模式）：`target_id`（必填）、`username`（必填）、`credential_ref`（必填，env-var 语法的名字——其值绝不进入对话），另有可选 `dc_ip`；`secrets_dump` 额外要求 `domain` 并提供可选的 `just_dc` 目录 DRSUAPI 转储开关。

#### Token 影响

这些工具向模型工具上下文追加三条描述与 JSON 模式；结果按 `maxOutputBytes`（默认 256 KiB）做字节上限。

#### KV Cache 影响

工具模式属于模型工具前缀的一部分，在已加载工具组合不变期间保持可缓存。

## 已知限制与延后工作
<a id="known-limitations-and-deferred-work"></a>

- 需要本地安装 impacket；各工具在可执行文件缺失时给出明确错误。
- 密码随 impacket 的 `domain/user:password` 目标参数传递，执行期间在本机进程列表可见——但绝不进入模型可见参数、结果或会话日志。
- `secrets_dump` 默认返回完整 hash 值（`redactionLevel: 'full'`）以供离线破解；设 `redactionLevel: 'masked'` 可把每个 hash 替换为 `[redacted]`。
- 这些调用不构造 egress；授权依赖目标、`credential-use` 动作与已授权凭据引用三者共同把关。
- Kerberos 票据（ccache）、委派攻击与 ADCS 工具（certipy、rbcd）延后到后续批次。

<a id="dev-note"></a>
### 开发注记

保持工具名、`credential_ref` 参数名与 `credentialTools` 接线同 `assessment-scope-tool-policy` 和 security-research bundle patch 同步。
