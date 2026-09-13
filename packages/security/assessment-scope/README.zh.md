---
description: "安全评估操作的类型化授权 scope 模型。"
kind: "package-reference"
---
# @deepseek-ai/dsh-assessment-scope

[English](README.md) | 中文

## 概述
本包定义安全评估的授权模型。Scope 命名目标、允许的操作、execution host、时间范围、凭据引用、egress 策略和证据规则。提供方发布经过验证的 grant；评估消费者必须在接纳工作前检查该 grant。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
将服务与 dsh-assessment-scope-static 等提供方一起挂载；需要 session 绑定时，再挂载 dsh-assessment-scope-session。在操作者提供明确授权之前，保持默认 grant 为空。

report-download 专门授权通过认证 Harness 客户端通道交付报告。它要求目标、Execution Host、有效期、审批与证据策略检查，不虚构外发端点。任意 data-export 与 external-reporting 仍要求精确网络出口授权。Consumer 必须选择与实际效果一致的操作。

<a id="model-experience"></a>
## 模型体验

间接通过执行授权策略的评估消费者产生影响。

#### KV Cache 影响

无直接影响；scope 数据只有通过消费者渲染授权评估结果后才会进入模型。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 本包建模授权，但不执行扫描或证明目标所有权。
- Grant 的加载和持久化方式由提供方决定。

invariant companion 校验 Session 流中的规范化授权、委派子集与已记录决策。空授权范围只会拒绝实际调用策略的 Consumer 操作。

<a id="dev-note"></a>
### 开发备注

空 scope 是有意的 deny-all 默认值，不是要求系统推断授权。
