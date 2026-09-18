---
description: "检查 Host 上 GitHub、GitLab 和 Gitee 的身份验证就绪状态，无需安装或激活集成。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-integration-preflight-controller

[English](README.md) | 中文

## 摘要

在使用集成前，检查 Host 上的 GitHub、GitLab 或 Gitee 身份验证是否可用。结果报告就绪状态和可选的账户提示，不暴露凭据。检查使用现有配置，不安装软件、执行登录或激活插件。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

在提供 `typert` 的 Cordis 组合中挂载此服务。Host 调用方使用 `ctx.integrationPreflightController.check({ provider }, signal)`；Remote 调用方使用 `integrationPreflight.check`。插件未定义可配置字段。

| 提供方 | Host 要求 | 身份验证检查 |
|---|---|---|
| `github` | Host PATH 中的 `gh` | GitHub CLI（命令行界面）身份验证状态 |
| `gitlab` | Host PATH 中的 `glab` | GitLab CLI 身份验证状态 |
| `gitee` | Host 环境中的 `GITEE_TOKEN` | Gitee 当前用户 API |

缺少配置、身份验证失败和探测失败都会返回带有稳定原因代码的就绪状态快照。调用方取消会使请求拒绝。检查成功时可能包含账户提示；不会返回原始命令输出或凭据值。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

服务在 `integrationPreflight` 命名空间中暴露 `check` Remote 方法。GitHub 和 GitLab 检查读取 CLI 身份验证状态。Gitee 检查读取已配置的 token，并在 token 存在时请求当前用户端点。每次调用返回一份快照，与插件激活相互独立。

本包不发布不变量配套入口，因为此控制器从当前 CLI 身份验证结果或 Gitee token 检查派生每份就绪状态快照，不保留需要核对的独立就绪状态或缓存。

公开方法和返回值见[探测实现](src/index.ts)及[请求和结果类型](src/types.ts)。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Cordis 入门](../../../docs/cordis-primer.zh.md)介绍服务激活和组合。
- [Typert 协议](../../typert/protocol/README.zh.md)负责 Remote 方法传输。
- [Harness 架构](../../../docs/architecture.zh.md)介绍插件组合和扩展点。

-----

<a id="model-experience"></a>
## 模型体验

无，因为控制器只报告集成就绪状态，不提供提示词、工具或模型可见事件。

#### KV Cache 影响

无；就绪状态检查不会组装或发送模型请求。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

就绪状态描述单次检查期间观察到的身份验证情况。

- 已连接结果不验证特定仓库的权限，也不证明集成插件已经激活。
- CLI 探测使用固定的 10 秒超时和 64 KiB 输出上限。Gitee HTTP 探测依赖调用方取消，控制器不设置独立超时。
- CLI 检查成功时，账户提示仍可能为 null。
