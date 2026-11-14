---
description: "面向模型的 nxc（NetExec）密码喷洒工具，用于已授权评估。"
kind: "package-reference"
---
# @cinlan/tool-nxc

[English](README.md) | 中文

## 摘要
本包在 `ctx.tools` 上注册 `nxc_spray` 工具。它通过 `ctx.subprocess` 以固定的 `--continue-on-success --no-banner` 标志调用本地安装的 `nxc`（NetExec）二进制，把命中行解析为有界的结构化行，并在每条存储行上抹除密码。账户密码在执行期经 `ctx.get('credentials')` 从模型提供的 `credential_ref` 解析，绝不进入模型可见参数、工具结果或会话日志。授权由上游 `assessment-scope-tool-policy` 按 `credential-use` 动作强制执行。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发注记](#dev-note)

<a id="use-this-package"></a>
## 使用本包
挂载 `@deepseek-ai/dsh-subprocess`（例如 `dsh-subprocess-local`）、`@deepseek-ai/dsh-tools`、一个凭据 Provider（例如 `@deepseek-ai/dsh-credentials-local`），以及配置了包含 `nxc_spray` 的 `credentialTools` 的 `@deepseek-ai/dsh-assessment-scope-tool-policy`。`nxc` 可执行文件必须能在执行主机 PATH 上解析，或通过 `config.command` 指定；将 `config.maxThreads` 设为部署可接受的工作并发上限。授权必须声明 `credential-use` 动作，并为被喷洒目标声明与所呈引用配对的 `credentials` 条目。

<a id="model-experience"></a>
## 模型体验

### nxc_spray 工具模式

#### 模型看到什么

模型收到生成的 [`nxc_spray` 模式](../../../docs/tool-catalog.zh.md#cinlantool-nxc)：`target_id`（必填主机，须匹配授权目标）、`usernames`（必填，1-100 个候选账户名）、`credential_ref`（必填，env-var 语法的名字——其值绝不进入对话），另有可选 `protocol`（默认 smb；ldap、mssql、winrm、ssh）、`domain` 与受 `maxThreads` 约束的 `threads`。

#### Token 影响

该工具向模型工具上下文追加一条描述与 JSON 模式；结果按 `maxOutputBytes`（默认 256 KiB）做字节上限。

#### KV Cache 影响

工具模式属于模型工具前缀的一部分，在已加载工具组合不变期间保持可缓存。

## 已知限制与延后工作
<a id="known-limitations-and-deferred-work"></a>

- 需要本地安装 NetExec；可执行文件缺失时工具会给出明确错误。
- nxc 会在成功命中行内回显密码；解析器从每条存储行上抹除已解析密码的全部出现，命中行只携带账户名与脱敏后的行文本。
- 密码随 `-p` 标志传递，执行期间在本机进程列表可见——但绝不进入模型可见参数、结果或会话日志。
- 账户锁定策略由评估方负责：本工具每次调用向每个候选账户发送一个密码，并发为配置值；请按锁定窗口安排喷洒节奏。
- 这些调用不构造 egress；授权依赖目标、`credential-use` 动作与已授权凭据引用三者共同把关。

<a id="dev-note"></a>
### 开发注记

保持工具名 `nxc_spray`、`credential_ref` 参数名与 `credentialTools` 接线同 `assessment-scope-tool-policy` 和 security-research bundle patch 同步。
