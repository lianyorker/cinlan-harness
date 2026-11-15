---
description: "面向模型的只读阿里云工具，用于已授权云环境评估。"
kind: "package-reference"
---
# @cinlan/tool-aliyun

[English](README.md) | 中文

## 概述
本包在 `ctx.tools` 上注册 `aliyun_identity_get`、`ram_enum`、`oss_enum`、`ram_policy_attach`、`ram_policy_detach` 五个工具。它通过 `ctx.subprocess` 调用本机安装的阿里云 CLI（`aliyun`），显式携带 `--region` 参数，把 stdout 解析为有界行，且从不发出文件输出参数。AccessKey 材料在执行时经 `ctx.get('credentials')` 从模型提供的 `credential_ref` 解析，并注入子进程环境变量（`ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET` / `ALIBABA_CLOUD_SECURITY_TOKEN`），绝不进入 argv、模型可见参数、工具结果或会话日志。授权由上游 `assessment-scope-tool-policy` 强制：`aliyun_identity_get` 走 `credential-use` 动作，`ram_enum` 与 `oss_enum` 经 `cloudTools` 走 `reconnaissance` 动作，策略附加/卸下对经 `cloudWriteTools` 走 `persistence-change` 动作。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## 使用本包
与 `@deepseek-ai/dsh-subprocess`（如 `dsh-subprocess-local` 的提供方）、`@deepseek-ai/dsh-tools`、凭据提供方（如 `@deepseek-ai/dsh-credentials-local`）以及配置了 `credentialTools` 含 `aliyun_identity_get`、`cloudTools` 含 `ram_enum` 和 `oss_enum` 的 `@deepseek-ai/dsh-assessment-scope-tool-policy` 一起挂载。`aliyun` 可执行文件必须能在 execution host 的 PATH 上解析，或经 `config.command` 指定。grant 必须声明 `cloud` 目标（provider 为 `aliyun`，目标 value 携带账户 id）、列出映射的动作，并携带把呈现的凭据引用与该目标配对的 `credentials` 条目。三个工具全部是只读调用；只读 API 请求仍计入账户请求配额。

凭据 secret 的格式是 `KEY=VALUE` 行，键限定为 `ALIBABA_CLOUD_ACCESS_KEY_ID`、`ALIBABA_CLOUD_ACCESS_KEY_SECRET` 和可选的 `ALIBABA_CLOUD_SECURITY_TOKEN`；key id 与 secret 两项必需，出现不支持的键会在执行时使调用失败。

<a id="model-experience"></a>
## Model Experience

### aliyun_identity_get 工具 schema

#### 模型所见

模型收到生成的 [`aliyun_identity_get` schema](../../../docs/tool-catalog.zh.md#cinlantool-aliyun)：`target_id`（必需，匹配 cloud grant 目标的账户 id）、`credential_ref`（必需，环境变量形状的名字——值绝不进入对话）、`region`（必需，落在目标的 region 允许列表内）。

### ram_enum 工具 schema

#### 模型所见

模型收到生成的 [`ram_enum` schema](../../../docs/tool-catalog.zh.md#cinlantool-aliyun)：`target_id`、`limit`（可选 `--PageSize`，默认 100）、可选 `credential_ref`、`region`，其中 `region` 必需。RAM 是全局产品：使用账户的中心 region。

### oss_enum 工具 schema

#### 模型所见

模型收到生成的 [`oss_enum` schema](../../../docs/tool-catalog.zh.md#cinlantool-aliyun)：`target_id`、可选 `credential_ref`、`region`、可选 `public_status`（逐桶 `ossutil api get-bucket-acl` 匿名读检查，要求 aliyun CLI 内嵌 ossutil 2.0 及以上）。结果是从内置 ossutil 文本列表解析出的桶行。

### ram_policy_attach 工具 schema

#### 模型所见

模型收到生成的 [`ram_policy_attach` schema](../../../docs/tool-catalog.zh.md#cinlantool-aliyun)：`target_id`、`policy_type`（`Custom` 或 `System`）、`policy_name`（已存在策略——绝不构造策略文档）、`username`、可选 `credential_ref`、`region`，前四项必需。把 `persistence-change` 列入 `approvalRequiredActions` 的授权会把每个此类调用转为审批提示。

### ram_policy_detach 工具 schema

#### 模型所见

模型收到生成的 [`ram_policy_detach` schema](../../../docs/tool-catalog.zh.md#cinlantool-aliyun)：参数集与 `ram_policy_attach` 相同；它回滚该授予。卸下未附加的策略会以明确的 CLI 错误失败。

#### Token 效应

五个工具向模型工具上下文各添加一条 description 与 JSON schema；结果字节上限由 `maxOutputBytes`（默认 256 KiB）约束。

#### KV Cache 效应

工具 schema 属于模型工具前缀的一部分，在加载的工具组合不变期间保持可缓存。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 需要本机安装阿里云 CLI；可执行文件缺失时工具给出明确错误。
- 凭据 secret 随子进程环境变量注入，执行期间同机同用户可经进程环境检查读取——但绝不进入模型可见参数、结果或会话日志。
- `oss_enum` 的列表解析读取内置 ossutil 的文本输出（每桶一行 `oss://bucket`）；`public_status` 检查使用 `aliyun ossutil api get-bucket-acl`，要求 aliyun CLI 内嵌 ossutil 2.0 及以上，超出 `maxPublicChecks`（默认 20）的桶报告为 `skipped`，无法读取 ACL 的桶报告为 `unknown`。
- RAM 角色与策略列表延期：本包只枚举用户。
- 阿里云写路径工具（资源变更、提权路径）延期：本包只做枚举与身份确认。

<a id="dev-note"></a>
### Dev Note

保持工具名、`credential_ref` 参数名、`credentialTools`/`cloudTools` 接线与 `cloud` 目标形状同 `assessment-scope-tool-policy` 和 security-research bundle patch 同步。
