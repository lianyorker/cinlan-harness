---
description: "Jira 工单读取与显式审批的 REST 写入。"
kind: "package-reference"
---

# @deepseek-ai/dsh-work-items-jira

[English](README.md) | 中文

## 概述

此 Provider 通过 Cloud REST API v3 向 [Work Items 服务](../work-items/README.zh.md) 提供 Jira 工单。读取限定于一个配置的站点与项目；外部写入默认关闭，需要启用 `allowWrites`，并由消费者完成服务独立的预览和确认流程。

## 目录

- [使用此包](#use-this-package)
- [指派与失败](#assignment-and-failures)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

将此函数插件与 `credentials`、`workItems` 一起挂载。通过 `origin` 指定站点 HTTPS origin，通过 `project` 指定 Jira 项目键。缺少站点或项目配置时 Provider 不可用。服务配置 `provider: jira` 显式选择此 Provider；服务允许多个 Provider 时，请求的 source 也可以选择它。

| 配置 | 行为 |
|---|---|
| `origin` | Jira 站点 HTTPS origin，例如 `https://example.atlassian.net`。 |
| `project` | 大写 Jira 项目键，例如 `ENG`。 |
| `credentialRef` | 每次请求解析的凭据引用，默认 `JIRA_CREDENTIAL`。取值必须为 `email:api-token`，以 HTTP Basic auth 发送。 |
| `issueType` | 创建工单使用的 issue type 名称，默认 `Task`。 |
| `allowWrites` | 默认 `false`；`true` 时启用 Provider writer。 |
| `timeoutMs` | 单次请求超时为 1–120000 ms，默认 30000。 |
| `maxItems` | 单页上限为 1–100 条工单，默认 50。 |

凭据保留在 Host。HTTPS origin 检查、拒绝重定向、有界响应、调用方取消、请求超时和 Provider 释放适用于读取与写入。Provider 在插件生命周期内注册 `jira`，释放时移除注册。

<a id="assignment-and-failures"></a>
## 指派与失败

创建、评论、状态和指派修改使用现有 Work Items 审批记录。状态值为 `open` 和 `closed`，分别映射到目标状态类别为非 done 或 done 的第一条工作流转换。指派至多接受一个显示名或邮箱：通过 `/rest/api/3/user/search` 解析，必须恰好匹配一个 `atlassian` 账户。空指派列表直接清除负责人，不查询用户。未知、歧义、格式错误、未授权或不可用的查询结果都会阻止该更新。工单描述与评论以有界 Atlassian Document Format 跨界传递；读取展平为纯文本，写入重建段落。

<a id="model-experience"></a>
## 模型体验

此包不贡献 prompt 或 model tool。`@deepseek-ai/dsh-tool-work-items` 暴露标准化读取与持久化写入审批协议；`jira:PROJECT-123` id 路由到此 Provider。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- Provider write 只有在 deployment configuration 启用 `allowWrites` 后才可用；每次面向模型的写入仍必须经过持久化预览和精确确认。
- JQL 固定为 `project = <配置键>` 加状态类别筛选；不支持任意 JQL、sprint/board 视图、评论历史、附件或 Data Center PAT 认证。
- Jira 工单只有一个负责人，因此指派至多一个账户。
- 状态写入依赖项目工作流中存在到达目标类别的可用转换。

<a id="dev-note"></a>
## 开发备注

Provider response data 与 credential 保持 Host 归属；生成 catalog 是 API inventory 的来源。
