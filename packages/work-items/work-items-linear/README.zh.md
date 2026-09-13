---
description: "Work Items package reference."
kind: "package-reference"
---

# @deepseek-ai/dsh-work-items-linear

[English](README.md) | 中文

## 概述

本包实现 Work Items 的一层 provider-neutral 职责，详细 runtime contract 见下方章节。

## 目录

- 概述
- 模型体验
- 已知限制与后续工作
- 开发备注

这个 Provider 通过固定的 https://api.linear.app/graphql endpoint 读取 Linear issue。它每次请求解析 CredentialRef，拒绝 redirect，限制 GraphQL response bytes 和 page size，并把经过校验的 issue node 映射为统一的 Work Item contract。请求只携带已配置的 team/project 标识和有界 filter。

## 配置

| 键 | 含义 |
|---|---|
| team / project | 结构化的 Linear scope 标识；至少配置一个才可用。 |
| credentialRef | 每次操作使用的 credential reference；secret 不会离开 Provider。 |
| timeoutMs / maxItems | 请求 timeout 和最大 page size。 |

Provider 不接受 endpoint、query URL、任意 header 或调用方提供的 GraphQL text。HTTP 与 GraphQL 的 authentication、authorization、not-found、rate-limit、response 和 cancellation failure 会被分类，但不会返回 response body。卸载 Provider 会在移除注册前中止在途 fetch 和 response-read 工作；若 credential 解析尚未完成，其结果会在任何 network request 启动前被丢弃。

## 显式写入

allowWrites 默认为 false；启用后仅由公共服务的预览/确认 API 驱动外部修改。创建需要配置 team，状态输入必须是同 team 的 workflow state ID，指派接受单个用户 UUID 或空列表以取消指派。每次修改前验证工单仍处于配置的 team/project scope。每个操作最多发送一个 mutation 请求，不自动重试。HTTP 400/422 与确定的输入拒绝单独分类；网络或异常响应交给公共服务记为可能已发生的 unknown。审批与恢复语义见 [Work Items 服务](../work-items/README.zh.md)。

## 模型体验

间接通过 tool-work-items Consumer，由它将标准化记录和写入回执呈现给模型。

#### 对 KV Cache 的影响

没有；credential 解析和 Linear request 不会改变 model request prefix。

## 已知限制与暂缓事项

- 本 Provider 不提供批量 mutation、删除、discovery 或任意保存的 view；支持的 mutation 使用 service-owned preview/confirm 审批 API。
- team 和 project filter 使用已配置的 Provider identifier；不支持 discovery 或任意保存的 view。


<a id="开发备注"></a>
### 开发备注

Provider credential 与 response normalization 保持在所属层。

No runtime invariant companion is published because 每次请求独立验证外部数据，不持久缓存 Provider 响应。
