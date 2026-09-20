---
description: "feedback 包组：关于会话与 assistant 消息的用户反馈，供用户与维护者选择、组合或排查反馈采集。"
kind: "package-group"
---

# feedback/：记录的人类反馈

[English](README.md) | 中文

## 概述

feedback 组记录用户对整个 Session 和单条 assistant 消息的意见，类别和评价均可省略。用户通过 `/feedback` 或产品集成提交 Session 反馈；产品集成通过 `messageFeedback` 读取和修改消息评分。两者使用相同的类别 id，均不进入模型历史。本页是组的映射；包 README 与[反馈子系统页](../../docs/subsystems/feedback.zh.md)负责各自的包级约定。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

| 包 | 职责 |
|---|---|
| [`command-feedback`](command-feedback/README.zh.md) | 通过 `/feedback`、直接生产方或 `sessionFeedback` 记录 Session 反馈，并提供共享类别 id |
| [`message-feedback`](message-feedback/README.zh.md) | 通过 `messageFeedback` 提供逐消息评分、类别与备注 |

会话评价是单向信号：在对话的任何时刻记录它都是安全的，且绝不会改变模型看到的内容。在 feedback-gated 共享策略下，记录会话评价正是释放会话共享的动作。

逐消息反馈保存在 Session 日志中，重启后依然存在，不进入模型历史。日志投递遵循配置的[遥测策略](../session/session-telemetry-otel/README.zh.md)。

<a id="related-documentation"></a>
## 相关文档

- [反馈子系统](../../docs/subsystems/feedback.zh.md)——message-feedback 的类型、服务契约与 Web 消费方。
- [会话遥测子系统](../../docs/subsystems/session-telemetry.zh.md)——共享已记录反馈与 Session 日志的策略。
- [匿名用户身份](../identity/README.zh.md)——嵌入反馈确认文本的按 harness home 共享 id。

<a id="dev-note"></a>
## 开发备注

无。
