---
description: "标准化 Provider Work Items 能力族。"
kind: "package-group"
---

# Work Items

[English](README.md) | 中文

## 概述

Work Items group 提供标准化 Provider 读取、持久化审批外部写入、Host Remote 投影和按 Workspace 归属的本地关联。

## 目录

- 概述
- 模型体验
- 已知限制与后续工作
- 开发备注

外部 Work Items capability：标准化 GitHub Issue 与 Linear issue、固定凭据 Provider、持久化 prepare/confirm 写入协议、Host API projection、面向模型的工具和可选的 Web Consumer。子系统参考位于 [`docs/subsystems/work-items.zh.md`](../../docs/subsystems/work-items.zh.md)。

## Packages

| 包 | 角色 | ctx key |
|---|---|---|
| `@deepseek-ai/dsh-work-items` | Service Definition：Provider registry 与 list/get contract | `ctx.workItems` |
| `@deepseek-ai/dsh-work-items-github` | Service Provider：固定 GitHub REST origin 与 Issue mapping | — |
| `@deepseek-ai/dsh-work-items-linear` | Service Provider：固定 Linear GraphQL endpoint、issue mapping 与 opt-in writer | — |
| `@deepseek-ai/dsh-tool-work-items` | Consumer：面向模型的标准化读取与持久化写入审批 | `ctx.tools` |

## Architecture

Service 与 Provider 负责 provider selection、有界 parsing、Host-only credential 和持久化外部写入语义；浏览器消费标准化 Remote projection，tool Consumer 则投影独立的 model-facing contract。

Provider result 不是 session event、prompt 或 attachment。面向模型的 Consumer 只暴露重建后的标准化字段、结构化 scope 和 service-owned prepare/confirm/cancel 协议，不暴露 transport 或 credential metadata。

## 模型体验

Service 与 Provider package 不贡献 prompt 或 model tool。`@deepseek-ai/dsh-tool-work-items` 提供六个工具，用于标准化读取、持久化写入预览、精确确认、取消和回执历史；Web Settings Consumer 仍服务于人类查看和本地关联。

## 已知限制与延期工作

- Provider write 只有在 deployment configuration 启用 `allowWrites` 后才可用；每次面向模型的写入仍必须经过持久化预览和精确确认。
- 不支持 repository/team discovery、同步、webhook、评论历史、attachment、GitHub Enterprise origin 或任意保存的 view。
- Workspace context 是显示 metadata，不会创建持久化 remote link，也不会修改本地 lease。


<a id="开发备注"></a>
### 开发备注

Provider response data 与 credential 保持 Host 归属；生成 catalog 是 API inventory 的来源。
