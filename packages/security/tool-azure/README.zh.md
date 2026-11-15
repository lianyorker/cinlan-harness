---
description: "面向模型的只读 Azure 工具，用于已授权云环境评估。"
kind: "package-reference"
---
# @cinlan/tool-azure

[English](README.md) | 中文

## 概述
本包在 `ctx.tools` 上注册 `az_account_show`、`azure_ad_enum`、`azure_storage_enum` 三个工具。它通过 `ctx.subprocess` 调用本机安装的 Azure CLI（`az`）；每次调用先以固定的 `--output json` argv 执行 service principal 登录，再执行只读列表调用，把 JSON 解析为有界行。client secret 在执行时经 `ctx.get('credentials')` 从模型提供的 `credential_ref` 解析，绝不进入模型可见参数、工具结果或会话日志。授权由上游 `assessment-scope-tool-policy` 强制：`az_account_show` 走 `credential-use` 动作，`azure_ad_enum` 与 `azure_storage_enum` 经 `cloudTools` 走 `reconnaissance` 动作。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## 使用本包
与 `@deepseek-ai/dsh-subprocess`（如 `dsh-subprocess-local` 的提供方）、`@deepseek-ai/dsh-tools`、凭据提供方（如 `@deepseek-ai/dsh-credentials-local`）以及配置了 `credentialTools` 含 `az_account_show`、`cloudTools` 含 `azure_ad_enum` 和 `azure_storage_enum` 的 `@deepseek-ai/dsh-assessment-scope-tool-policy` 一起挂载。`az` 可执行文件必须能在 execution host 的 PATH 上解析，或经 `config.command` 指定。grant 必须声明 `cloud` 目标（provider 为 `azure`，目标 value 携带账户 id）、列出映射的动作，并携带把呈现的凭据引用与该目标配对的 `credentials` 条目。三个工具全部是只读调用；只读 API 请求仍计入租户配额。

凭据 secret 的格式是 `KEY=VALUE` 行，键限定为 `AZURE_CLIENT_ID`、`AZURE_TENANT_ID`、`AZURE_CLIENT_SECRET` 和可选的 `AZURE_SUBSCRIPTION_ID`；前三项必需，id 必须是 GUID，出现不支持的键会在执行时使调用失败。

<a id="model-experience"></a>
## Model Experience

### az_account_show 工具 schema

#### 模型所见

模型收到生成的 [`az_account_show` schema](../../../docs/tool-catalog.zh.md#cinlantool-azure)：`target_id`（必需，匹配 cloud grant 目标的账户 id）、`credential_ref`（必需，环境变量形状的名字——值绝不进入对话）。结果为携带 tenant id 的订阅行。

### azure_ad_enum 工具 schema

#### 模型所见

模型收到生成的 [`azure_ad_enum` schema](../../../docs/tool-catalog.zh.md#cinlantool-azure)：`target_id`、`resource`（必需，`users`、`role-assignments` 之一）、`credential_ref`、可选 `subscription`（GUID，须落在目标的 subscription 允许列表内）。

### azure_storage_enum 工具 schema

#### 模型所见

模型收到生成的 [`azure_storage_enum` schema](../../../docs/tool-catalog.zh.md#cinlantool-azure)：`target_id`、`credential_ref`、可选 `subscription`。结果为账户行，携带 `allowBlobPublicAccess` 与 HTTPS-only 设置。

#### Token 效应

三个工具向模型工具上下文各添加一条 description 与 JSON schema；结果字节上限由 `maxOutputBytes`（默认 256 KiB）约束。

#### KV Cache 效应

工具 schema 属于模型工具前缀的一部分，在加载的工具组合不变期间保持可缓存。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 需要本机安装 Azure CLI；可执行文件缺失时工具给出明确错误。
- az CLI 没有基于环境变量的 service principal 登录方式，因此 client secret 随 `az login` 的 argv 传递，执行期间本机进程列表可见——但绝不进入模型可见参数、结果或会话日志。
- 每个工具调用都执行自己的 `az login`，会更新操作者本机 `~/.azure` 登录状态；除该状态外，调用参数不使用操作者的 az 本机默认配置（订阅默认值）。
- `az ad user list` 调用没有服务端页上限；目录极大的账户会被 `maxOutputBytes` 截断报错，而非静默截断。
- Azure 写路径工具（角色分配变更、资源创建）延期：本包只做枚举与身份确认。

<a id="dev-note"></a>
### Dev Note

保持工具名、`credential_ref` 参数名、`credentialTools`/`cloudTools` 接线与 `cloud` 目标形状同 `assessment-scope-tool-policy` 和 security-research bundle patch 同步。
