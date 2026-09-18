---
description: "GitLab 工单读取与显式审批的 REST 写入。"
kind: "package-reference"
---

# @deepseek-ai/dsh-work-items-gitlab

[English](README.md) | 中文

## 概述

此 Provider 通过 REST API v4 向 [Work Items 服务](../work-items/README.zh.md) 提供 GitLab 工单。读取限定于一个配置的项目；外部写入默认关闭，需要启用 `allowWrites`，并由消费者完成服务独立的预览和确认流程。

## 目录

- [使用此包](#use-this-package)
- [指派与失败](#assignment-and-failures)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

将此函数插件与 `credentials`、`workItems` 一起挂载。通过 `owner` 指定 GitLab namespace，通过 `repository` 指定项目名称。缺少项目配置时 Provider 不可用。服务配置 `provider: gitlab` 显式选择此 Provider；服务允许多个 Provider 时，请求的 source 也可以选择它。

| 配置 | 行为 |
|---|---|
| `origin` | HTTPS origin，默认 `https://gitlab.com`。 |
| `credentialRef` | 每次请求解析的凭据引用，默认 `GITLAB_TOKEN`。 |
| `allowWrites` | 默认 `false`；`true` 时启用 Provider writer。 |
| `timeoutMs` | 单次请求超时为 1–120000 ms，默认 30000。 |
| `maxItems` | 单页上限为 1–100 条工单，默认 50。 |

凭据保留在 Host。HTTPS origin 检查、拒绝重定向、有界响应、调用方取消、请求超时和 Provider 释放适用于读取与写入。Provider 在插件生命周期内注册 `gitlab`，释放时移除注册。

<a id="assignment-and-failures"></a>
## 指派与失败

创建、评论、状态和指派修改使用现有 Work Items 审批记录。状态值为 `opened` 和 `closed`。指派接受用户名：每个用户名通过 `/api/v4/users?username=…` 查询，必须恰好解析为一个用户名匹配且 id 为正安全整数的用户。用户名匹配不区分大小写。Provider 在发送工单更新前解析全部被指派人，并在执行时重新校验。未知、歧义、格式错误、未授权或不可用的查询结果都会阻止该更新。空指派列表直接清除指派，不查询用户名。

预览不会修改工单。服务在 `work_item_writes` 中保存审批及终态回执；重复确认或重新加载成功回执不会再次发送外部修改。若服务在发送后报告结果不确定，应先在 GitLab 核实，再准备下一次操作。

<a id="model-experience"></a>
## 模型体验

间接通过 Work Items 服务及其 tool 消费者生效，标准化工单与写入回执的渲染由消费者负责。

#### KV Cache 影响

此 Provider 不注册模型请求前缀，也不替换已有请求 token。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 每个 Provider 实例只服务一个已配置项目。指派除工单写入权限外，还要求能够查询 GitLab 用户。
- 不提供外部删除或不确定写入的自动重试。审批版本检查不是 GitLab 端的原子 compare-and-swap。
- API 请求从配置的 origin 根目录发起，不支持部署在 HTTP 路径前缀下的 GitLab。

<a id="dev-note"></a>
### 开发备注

Provider 负责 REST 响应校验和用户名到 id 的解析。Work Items 服务负责不可变审批内容、来源选择及持久回执。不发布 runtime invariant companion，因为此适配器不维护独立的持久投影；Provider 状态通过请求和服务拥有的记录观察。
