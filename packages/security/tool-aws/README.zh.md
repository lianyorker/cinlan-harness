---
description: "面向模型的只读 AWS 工具，用于已授权云环境评估。"
kind: "package-reference"
---
# @cinlan/tool-aws

[English](README.md) | 中文

## 概述
本包在 `ctx.tools` 上注册 `sts_get_caller_identity`、`iam_enum`、`s3_enum` 三个工具。它通过 `ctx.subprocess` 调用本机安装的 AWS CLI v2（`aws`），固定 `--output json --no-cli-paginate` 旗标，把 JSON 解析为有界行，且从不发出文件输出参数。AWS 密钥材料在执行时经 `ctx.get('credentials')` 从模型提供的 `credential_ref` 解析，并注入子进程环境变量（`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`），绝不进入 argv、模型可见参数、工具结果或会话日志。授权由上游 `assessment-scope-tool-policy` 强制：`sts_get_caller_identity` 走 `credential-use` 动作，`iam_enum` 与 `s3_enum` 经 `cloudTools` 走 `reconnaissance` 动作。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## 使用本包
与 `@deepseek-ai/dsh-subprocess`（如 `dsh-subprocess-local` 的提供方）、`@deepseek-ai/dsh-tools`、凭据提供方（如 `@deepseek-ai/dsh-credentials-local`）以及配置了 `credentialTools` 含 `sts_get_caller_identity`、`cloudTools` 含 `iam_enum` 和 `s3_enum` 的 `@deepseek-ai/dsh-assessment-scope-tool-policy` 一起挂载。`aws` 可执行文件必须能在 execution host 的 PATH 上解析，或经 `config.command` 指定。grant 必须声明 `cloud` 目标（provider 为 `aws`，目标 value 携带账户 id）、列出映射的动作，并携带把呈现的凭据引用与该目标配对的 `credentials` 条目。三个工具全部是只读的 List/Get/STS 调用；只读 API 请求仍计入账户请求配额。

凭据 secret 的格式是 `KEY=VALUE` 行，键限定为 `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY` 和可选的 `AWS_SESSION_TOKEN`；key id 与 secret 两项必需，出现不支持的键会在执行时使调用失败。

<a id="model-experience"></a>
## Model Experience

### sts_get_caller_identity 工具 schema

#### 模型所见

模型收到生成的 [`sts_get_caller_identity` schema](../../../docs/tool-catalog.zh.md#cinlantool-aws)：`target_id`（必需，匹配 cloud grant 目标的账户 id）、`credential_ref`（必需，环境变量形状的名字——值绝不进入对话），以及可选 `region`（必须落在目标声明的 region 允许列表内）。

### iam_enum 工具 schema

#### 模型所见

模型收到生成的 [`iam_enum` schema](../../../docs/tool-catalog.zh.md#cinlantool-aws)：`target_id`（必需）、`resource`（必需，`users`、`roles`、`policies` 之一——policies 限定账户本地）、`limit`（可选 `--max-items`，默认 100）、可选 `credential_ref`（以子进程环境变量注入；缺省时由本机 AWS 配置链提供凭据），以及可选 `region`。

### s3_enum 工具 schema

#### 模型所见

模型收到生成的 [`s3_enum` schema](../../../docs/tool-catalog.zh.md#cinlantool-aws)：`target_id`（必需）、可选 `credential_ref`（以子进程环境变量注入；缺省时由本机 AWS 配置链提供凭据）、可选 `region`、可选 `public_status`（逐桶 `get-bucket-policy-status`；该检查按 region 作用域执行，必须显式传 region）。

#### Token 效应

三个工具向模型工具上下文各添加一条 description 与 JSON schema；结果字节上限由 `maxOutputBytes`（默认 256 KiB）约束。

#### KV Cache 效应

工具 schema 属于模型工具前缀的一部分，在加载的工具组合不变期间保持可缓存。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 需要本机安装 AWS CLI v2；可执行文件缺失时工具给出明确错误。
- 凭据 secret 随子进程环境变量注入，执行期间同机同用户可经进程环境检查读取——但绝不进入模型可见参数、结果或会话日志。
- `s3_enum` 的公开策略检查按 region 作用域执行：位于所传 `region` 之外的桶报告为 `unknown`，超出 `maxPublicChecks`（默认 20）的桶报告为 `skipped`。
- AWS IAM 是全局服务；可选 `region` 旗标只影响端点路由，不影响 `list-users` / `list-roles` / `list-policies` 的资源范围。
- AWS 写路径工具（资源变更、提权路径）延期：本包只做枚举与身份确认。

<a id="dev-note"></a>
### Dev Note

保持工具名、`credential_ref` 参数名、`credentialTools`/`cloudTools` 接线与 `cloud` 目标形状同 `assessment-scope-tool-policy` 和 security-research bundle patch 同步。
