---
description: "面向模型的只读 GCP 工具，用于已授权云环境评估。"
kind: "package-reference"
---
# @cinlan/tool-gcp

[English](README.md) | 中文

## 概述
本包在 `ctx.tools` 上注册 `gcp_identity_get`、`gcp_iam_enum`、`gcs_enum`、`gcs_bucket_iam`、`iam_binding_add`、`iam_binding_remove` 六个工具。它通过 `ctx.subprocess` 调用本机安装的 gcloud CLI，固定 `--format=json` 旗标并显式携带 `--project` 参数，把 JSON 解析为有界行，且从不发出文件输出参数。service-account JSON 在执行时经 `ctx.get('credentials')` 从模型提供的 `credential_ref` 解析，校验为 service-account JSON 后写入私有临时文件（权限 0600），仅通过 `CLOUDSDK_AUTH_CREDENTIALS_FILE_OVERRIDE` 环境变量暴露给 gcloud；调用结束时删除该文件。secret 绝不进入 argv、模型可见参数、工具结果或会话日志。授权由上游 `assessment-scope-tool-policy` 强制：`gcp_identity_get` 走 `credential-use` 动作，`gcp_iam_enum`、`gcs_enum`、`gcs_bucket_iam` 经 `cloudTools` 走 `reconnaissance` 动作，绑定对经 `cloudWriteTools` 走 `persistence-change` 动作。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## 使用本包
与 `@deepseek-ai/dsh-subprocess`（如 `dsh-subprocess-local` 的提供方）、`@deepseek-ai/dsh-tools`、凭据提供方（如 `@deepseek-ai/dsh-credentials-local`）以及配置了 `credentialTools` 含 `gcp_identity_get`、`cloudTools` 含 `gcp_iam_enum` 和 `gcs_enum` 的 `@deepseek-ai/dsh-assessment-scope-tool-policy` 一起挂载。`gcloud` 可执行文件必须能在 execution host 的 PATH 上解析，或经 `config.command` 指定。grant 必须声明 `cloud` 目标（provider 为 `gcp`，目标 value 携带账户 id）并带有 `projects` 允许列表、列出映射的动作，且携带把呈现的凭据引用与该目标配对的 `credentials` 条目。三个工具全部是只读调用；只读 API 请求仍计入项目配额。

凭据 secret 就是 service-account JSON 文档本身；不是 `type: 'service_account'` 的 JSON 会在执行时失败。每个工具调用都需要 `credential_ref`，因为 gcloud 每次调用都需要身份文件。

<a id="model-experience"></a>
## Model Experience

### gcp_identity_get 工具 schema

#### 模型所见

模型收到生成的 [`gcp_identity_get` schema](../../../docs/tool-catalog.zh.md#cinlantool-gcp)：`target_id`（必需，匹配 cloud grant 目标的账户 id）、`project`（必需，落在目标的 project 允许列表内）、`credential_ref`（必需，环境变量形状的名字——值绝不进入对话）。

### gcp_iam_enum 工具 schema

#### 模型所见

模型收到生成的 [`gcp_iam_enum` schema](../../../docs/tool-catalog.zh.md#cinlantool-gcp)：`target_id`、`project`、`credential_ref`，全部必需。结果为角色绑定行及其成员列表。

### gcs_enum 工具 schema

#### 模型所见

模型收到生成的 [`gcs_enum` schema](../../../docs/tool-catalog.zh.md#cinlantool-gcp)：`target_id`、`project`、`credential_ref`，全部必需。结果为桶行，携带每个桶的 `publicAccessPrevention` 设置——`enforced` 表示阻止公开暴露，`inherited` 表示未阻止。

### gcs_bucket_iam 工具 schema

#### 模型所见

模型收到生成的 [`gcs_bucket_iam` schema](../../../docs/tool-catalog.zh.md#cinlantool-gcp)：`target_id`、`credential_ref`、`bucket`（`gcs_enum` 报告的桶名，不含 `gs://` 前缀），全部必需。结果为桶的 IAM 角色绑定行，以及 `public` 标志——报告匿名主体（`allUsers` / `allAuthenticatedUsers`）是否持有任一角色。

### iam_binding_add 工具 schema

#### 模型所见

模型收到生成的 [`iam_binding_add` schema](../../../docs/tool-catalog.zh.md#cinlantool-gcp)：`target_id`、`project`、`member`（`user:<email>` / `serviceAccount:<email>` / `group:<email>` / `domain:<domain>`）、`role`（已存在的 `roles/<name>`——绝不构造策略文档）、`credential_ref`，全部必需。把 `persistence-change` 列入 `approvalRequiredActions` 的授权会把每个此类调用转为审批提示。

### iam_binding_remove 工具 schema

#### 模型所见

模型收到生成的 [`iam_binding_remove` schema](../../../docs/tool-catalog.zh.md#cinlantool-gcp)：参数集与 `iam_binding_add` 相同；它回滚该绑定。移除不存在的绑定会以明确的 CLI 错误失败。

#### Token 效应

六个工具向模型工具上下文各添加一条 description 与 JSON schema；结果字节上限由 `maxOutputBytes`（默认 256 KiB）约束。

#### KV Cache 效应

工具 schema 属于模型工具前缀的一部分，在加载的工具组合不变期间保持可缓存。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 需要本机安装 gcloud CLI；可执行文件缺失时工具给出明确错误。
- 凭据文件位于私有临时目录中，执行期间同机同用户可读取——但 secret 绝不进入 argv、模型可见参数、结果或会话日志，且目录在每次调用后删除。
- gcloud 会读取操作者本机配置的默认 project 与 region；本包每次调用都显式携带 project 参数，但其余环境默认值（account、quota project）仍来自本机配置。
- `gcs_enum` 报告 public-access-prevention 设置；桶级 IAM 转储由独立的 `gcs_bucket_iam` 工具提供。
- GCP 写路径工具（IAM 变更、资源创建）延期：本包只做枚举与身份确认。

<a id="dev-note"></a>
### Dev Note

保持工具名、`credential_ref` 参数名、`credentialTools`/`cloudTools` 接线与 `cloud` 目标形状同 `assessment-scope-tool-policy` 和 security-research bundle patch 同步。
