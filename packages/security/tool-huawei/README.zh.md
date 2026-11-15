---
description: "面向模型的只读华为云工具，用于已授权云环境评估。"
kind: "package-reference"
---
# @cinlan/tool-huawei

[English](README.md) | 中文

## 概述
本包在 `ctx.tools` 上注册 `huawei_identity_get`、`huawei_iam_enum`、`obs_enum`、`iam_group_add_user`、`iam_group_remove_user` 五个工具。它通过 `ctx.subprocess` 调用华为云 KooCLI（`hcloud`）——该二进制名与无关的 Hetzner Cloud CLI 同名，因此所有错误信息都明确写出"华为云 KooCLI"；`obs_enum` 使用独立的 `obsutil` 二进制。KooCLI 调用携带固定的 region 与 project 参数并输出 JSON；obsutil 列表输出文本行并解析为有界行。从不发出文件输出参数。访问密钥对在执行时经 `ctx.get('credentials')` 从模型提供的 `credential_ref` 解析，绝不进入模型可见参数、工具结果或会话日志。授权由上游 `assessment-scope-tool-policy` 强制：`huawei_identity_get` 走 `credential-use` 动作，`huawei_iam_enum` 与 `obs_enum` 经 `cloudTools` 走 `reconnaissance` 动作，组成员对经 `cloudWriteTools` 走 `persistence-change` 动作。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## 使用本包
与 `@deepseek-ai/dsh-subprocess`（如 `dsh-subprocess-local` 的提供方）、`@deepseek-ai/dsh-tools`、凭据提供方（如 `@deepseek-ai/dsh-credentials-local`）以及配置了 `credentialTools` 含 `huawei_identity_get`、`cloudTools` 含 `huawei_iam_enum` 和 `obs_enum` 的 `@deepseek-ai/dsh-assessment-scope-tool-policy` 一起挂载。`hcloud`（华为云 KooCLI）与 `obsutil` 可执行文件必须能在 execution host 的 PATH 上解析，或经 `config.command` / `config.obsCommand` 指定。grant 必须声明 `cloud` 目标（provider 为 `huawei`，目标 value 携带账户 id）、列出映射的动作，并携带把呈现的凭据引用与该目标配对的 `credentials` 条目。三个工具全部是只读调用；只读 API 请求仍计入账户请求配额。

凭据 secret 的格式是 `KEY=VALUE` 行，键限定为 `HW_ACCESS_KEY_ID`、`HW_SECRET_ACCESS_KEY` 和可选的 `HW_SECURITY_TOKEN`；key id 与 secret key 两项必需，出现不支持的键会在执行时使调用失败。

<a id="model-experience"></a>
## Model Experience

### huawei_identity_get 工具 schema

#### 模型所见

模型收到生成的 [`huawei_identity_get` schema](../../../docs/tool-catalog.zh.md#cinlantool-huawei)：`target_id`（必需，匹配 cloud grant 目标的账户 id）、`credential_ref`（必需，环境变量形状的名字——值绝不进入对话）、`region`（必需，落在目标的 region 允许列表内）。

### huawei_iam_enum 工具 schema

#### 模型所见

模型收到生成的 [`huawei_iam_enum` schema](../../../docs/tool-catalog.zh.md#cinlantool-huawei)：`target_id`、`resource`（必需，`users` 或 `keys`——账户的永久访问密钥）、`project_id`（必需——IAM v3 列表按 project 作用域）、`credential_ref`、`region`，全部必需。

### obs_enum 工具 schema

#### 模型所见

模型收到生成的 [`obs_enum` schema](../../../docs/tool-catalog.zh.md#cinlantool-huawei)：`target_id`、`credential_ref`、`region`，全部必需。结果是从 obsutil 文本列表解析出的桶行。

### iam_group_add_user 工具 schema

#### 模型所见

模型收到生成的 [`iam_group_add_user` schema](../../../docs/tool-catalog.zh.md#cinlantool-huawei)：`target_id`、`user_id`、`group_id`（已存在的组——组的自有策略决定该成员关系授予什么；绝不构造组或策略文档）、`credential_ref`、`region`，全部必需。把 `persistence-change` 列入 `approvalRequiredActions` 的授权会把每个此类调用转为审批提示。

### iam_group_remove_user 工具 schema

#### 模型所见

模型收到生成的 [`iam_group_remove_user` schema](../../../docs/tool-catalog.zh.md#cinlantool-huawei)：参数集与 `iam_group_add_user` 相同；它回滚该成员关系。移除不存在的成员关系会以明确的 CLI 错误失败。

#### Token 效应

五个工具向模型工具上下文各添加一条 description 与 JSON schema；结果字节上限由 `maxOutputBytes`（默认 256 KiB）约束。

#### KV Cache 效应

工具 schema 属于模型工具前缀的一部分，在加载的工具组合不变期间保持可缓存。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 需要本机安装华为云 KooCLI 与 obsutil；可执行文件缺失时工具给出明确错误并指出缺失的是哪个可执行文件。
- KooCLI 与 obsutil 都没有基于环境变量的凭据通道，因此访问密钥对随 argv 传递（`--cli-secret-key` / `-k=`），执行期间本机进程列表可见——但绝不进入模型可见参数、结果或会话日志。
- KooCLI 的二进制名 `hcloud` 与无关的 Hetzner Cloud CLI 同名；`config.command` 指向华为云 KooCLI，错误信息会明确写出。
- IAM 用户与密钥列表反映 KooCLI 对 IAM (v3) 载荷的 snake_case 序列化；IAM 角色与策略列表延期。
- `obs_enum` 的公开性检查延期：obsutil 仅通过其 API 子命令暴露桶 ACL 细节，需要专门集成。
- 华为云写路径工具（IAM 变更、资源创建）延期：本包只做枚举与身份确认。

<a id="dev-note"></a>
### Dev Note

保持工具名、`credential_ref` 参数名、`credentialTools`/`cloudTools` 接线与 `cloud` 目标形状同 `assessment-scope-tool-policy` 和 security-research bundle patch 同步。
