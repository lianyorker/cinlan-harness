---
description: "严格配置的评估目标与操作授权提供方。"
kind: "package-reference"
---
# @deepseek-ai/dsh-assessment-scope-static

[English](README.md) | 中文

## 概述
本提供方加载一份操作者定义的评估 grant，并通过 assessment-scope 服务公开它。它在发布前验证时间范围、execution-host id、目标选择器、操作权限、egress 规则、凭据引用和证据策略。空 grant 合法且会拒绝评估工作。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
使用 assessment-scope 服务挂载带有明确 root grant 的提供方。在后续 profile patch 中维护授权目标、操作、execution host 和证据规则，不要依赖默认值。

<a id="model-experience"></a>
## 模型体验

间接通过应用配置授权策略的评估消费者产生影响。

#### KV Cache 影响

无直接影响；scope 配置只有通过消费者纳入授权评估结果后才会进入模型。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 提供方不执行评估操作，也不证明目标所有权。
- Scope 变化需要新的提供方配置，不会原地改变活动 grant。

不发布 runtime invariant companion，因为提供方发布一份经过验证的不可变 grant，没有独立可变观察。

<a id="dev-note"></a>
### 开发备注

security-research profile 有意挂载空的非授权 grant。
