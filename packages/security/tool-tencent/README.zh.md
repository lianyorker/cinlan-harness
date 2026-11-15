---
description: "面向模型的只读腾讯云工具，用于已授权云环境评估。"
kind: "package-reference"
---
# @cinlan/tool-tencent

[English](README.md) | 中文

## 概述
本包在 `ctx.tools` 上注册 `tencent_identity_get`、`cam_enum`、`cos_enum` 三个工具。它通过 `ctx.subprocess` 调用本机安装的腾讯云 tccli，固定 `--output json` 旗标并显式携带 `--region` 参数，把 JSON 解析为有界行，且从不发出文件输出参数。CAM 密钥材料在执行时经 `ctx.get('credentials')` 从模型提供的 `credential_ref` 解析，并注入子进程环境变量（`TENCENTCLOUD_SECRETID` / `TENCENTCLOUD_SECRETKEY` / `TENCENTCLOUD_SESSION_TOKEN`），绝不进入 argv、模型可见参数、工具结果或会话日志。授权由上游 `assessment-scope-tool-policy` 强制：`tencent_identity_get` 走 `credential-use` 动作，`cam_enum` 与 `cos_enum` 经 `cloudTools` 走 `reconnaissance` 动作。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## 使用本包
与 `@deepseek-ai/dsh-subprocess`（如 `dsh-subprocess-local` 的提供方）、`@deepseek-ai/dsh-tools`、凭据提供方（如 `@deepseek-ai/dsh-credentials-local`）以及配置了 `credentialTools` 含 `tencent_identity_get`、`cloudTools` 含 `cam_enum` 和 `cos_enum` 的 `@deepseek-ai/dsh-assessment-scope-tool-policy` 一起挂载。`tccli` 可执行文件必须能在 execution host 的 PATH 上解析，或经 `config.command` 指定。grant 必须声明 `cloud` 目标（provider 为 `tencent`，目标 value 携带账户 id）、列出映射的动作，并携带把呈现的凭据引用与该目标配对的 `credentials` 条目。三个工具全部是只读调用；只读 API 请求仍计入账户请求配额。

凭据 secret 的格式是 `KEY=VALUE` 行，键限定为 `TENCENTCLOUD_SECRETID`、`TENCENTCLOUD_SECRETKEY` 和可选的 `TENCENTCLOUD_SESSION_TOKEN`；secret id 与 secret key 两项必需，出现不支持的键会在执行时使调用失败。

<a id="model-experience"></a>
## Model Experience

### tencent_identity_get 工具 schema

#### 模型所见

模型收到生成的 [`tencent_identity_get` schema](../../../docs/tool-catalog.zh.md#cinlantool-tencent)：`target_id`（必需，匹配 cloud grant 目标的账户 id）、`credential_ref`（必需，环境变量形状的名字——值绝不进入对话）、`region`（必需，落在目标的 region 允许列表内）。

### cam_enum 工具 schema

#### 模型所见

模型收到生成的 [`cam_enum` schema](../../../docs/tool-catalog.zh.md#cinlantool-tencent)：`target_id`、`resource`（必需，`users`、`roles` 之一）、`limit`（可选页上限，默认 100）、可选 `credential_ref`（以子进程环境变量注入；缺省时由本机 tccli 配置链提供凭据）、`region`（必需）。

### cos_enum 工具 schema

#### 模型所见

模型收到生成的 [`cos_enum` schema](../../../docs/tool-catalog.zh.md#cinlantool-tencent)：`target_id`、`region`、可选 `credential_ref`（以子进程环境变量注入；缺省时由本机 tccli 配置链提供凭据）、可选 `public_status`（逐桶 `GetBucketAcl` 匿名读检查）。

#### Token 效应

三个工具向模型工具上下文各添加一条 description 与 JSON schema；结果字节上限由 `maxOutputBytes`（默认 256 KiB）约束。

#### KV Cache 效应

工具 schema 属于模型工具前缀的一部分，在加载的工具组合不变期间保持可缓存。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 需要本机安装腾讯云 tccli；可执行文件缺失时工具给出明确错误。
- 凭据 secret 随子进程环境变量注入，执行期间同机同用户可经进程环境检查读取——但绝不进入模型可见参数、结果或会话日志。
- CAM 角色列表使用 `ListRoles` API 的 `--page`/`--rp` 分页参数，与用户列表的 `--limit`/`--offset` 不同；重命名这些参数的 tccli 版本会以明确的 CLI 错误失败。
- `cos_enum` 的公开状态检查经 API 3.0 信封读取 XML API 的 ACL 包装；无法解析 ACL 的桶报告为 `unknown`，超出 `maxPublicChecks`（默认 20）的桶报告为 `skipped`。
- 腾讯云写路径工具（资源变更、提权路径）延期：本包只做枚举与身份确认。

<a id="dev-note"></a>
### Dev Note

保持工具名、`credential_ref` 参数名、`credentialTools`/`cloudTools` 接线与 `cloud` 目标形状同 `assessment-scope-tool-policy` 和 security-research bundle patch 同步。
