---
description: "Work Items package reference."
kind: "package-reference"
---

# @deepseek-ai/dsh-work-items-github

[English](README.md) | 中文

## 概述

本包实现 Work Items 的一层 provider-neutral 职责，详细 runtime contract 见下方章节。

## 目录

- 概述
- 模型体验
- 已知限制与后续工作
- 开发备注

这个 Provider 通过固定的 https://api.github.com origin 读取一个已配置 repository 的 GitHub Issue。它每次操作解析 CredentialRef，只把凭据放入 Authorization header，拒绝 redirect，限制 response bytes 和 page size，并把 issue 映射为 provider-neutral Work Item contract。Pull request 会被排除。

## 配置

| 键 | 含义 |
|---|---|
| owner / repository | 结构化的 GitHub repository 标识。 |
| credentialRef | 每次操作解析的 credential reference；值不会返回。 |
| timeoutMs / maxItems | 请求 timeout 和最大 page size。 |

Provider 不接受 endpoint 或任意 request header。它的 cheap available check 不会连接 GitHub，也不会读取 credential。认证、权限、not-found、rate-limit、response 和 cancellation failure 使用安全的 WorkItemsError 分类。卸载 Provider 会在移除注册前中止在途 fetch 和 response-read 工作；若 credential 解析尚未完成，其结果会在任何 network request 启动前被丢弃。

## 显式写入

allowWrites 默认为 false；启用后仅由公共服务的预览/确认 API 驱动外部修改。创建和评论用 POST，状态与指派用 PATCH；状态仅接受 open/closed，指派使用 login。每个操作最多发送一个 mutation 请求，不自动重试。HTTP 400/422 与确定的输入拒绝单独分类；网络或异常响应交给公共服务记为可能已发生的 unknown。审批与恢复语义见 [Work Items 服务](../work-items/README.zh.md)。

## 模型体验

间接通过 tool-work-items Consumer，由它将标准化记录和写入回执呈现给模型。

#### 对 KV Cache 的影响

没有；credential 解析和 GitHub request 不会改变 model request prefix。

## 已知限制与暂缓事项

- 本 Provider 不提供 pull-request workflow、批量 mutation 或 external deletion；支持的写操作使用 service-owned preview/confirm 审批 API。
- 本 Provider 不接受 Enterprise GitHub origin 或 repository discovery。
- 评论历史仅在单条 `get` 且 issue 报告有评论时拉取，保留最新 20 条；`list` 保持单次请求。
- 嵌入 issue body markdown 的附件不作为结构化元数据暴露。
- issue milestone 以标准化迭代元数据暴露——标题、状态和截止日期。
- GitHub issue 没有原生 priority 字段，不从 label 推断优先级。
- GitHub issue 没有原生 due-date 字段，milestone 截止日期通过 `iteration` 暴露。
- GitHub issue 没有原生 estimate 或时间跟踪字段。
- issue `parent` 在指向已配置仓库内的工单时以 `parentId` 暴露；跨仓库父工单省略。当 issue 报告 `sub_issues_summary` 时，`get` 会读取 `sub_issues` 并把每个子工单以 `sub-issue` 类型的 `links` 条目暴露，至多 20 条。
- `boards` 通过 GraphQL 用同一凭据读取 owner 的 Projects v2 看板：Status 单选字段成为列，每列给出有界的 `github:` issue id。没有单选字段的 project 不产出看板；草稿工单与 pull request 会被跳过。


<a id="开发备注"></a>
### 开发备注

Provider credential 与 response normalization 保持在所属层。

No runtime invariant companion is published because 每次请求独立验证外部数据，不持久缓存 Provider 响应。
