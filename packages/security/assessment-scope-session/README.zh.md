---
description: "用于授权评估 scope decision 的 Session 绑定提供方。"
kind: "package-reference"
---
# @deepseek-ai/dsh-assessment-scope-session

[English](README.md) | 中文

## 概述
本提供方将当前 Session 绑定到评估 scope，并记录评估消费者使用的 scope decision。它保留类型化授权 grant，同时把目标和操作策略交给 scope 服务。需要在一次运行中携带明确评估上下文时使用它。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
与 dsh-assessment-scope 和 Session 提供方一起挂载。提供方为执行目标、操作、host、egress 和证据策略检查的消费者解析 session 所属 scope 绑定。

<a id="model-experience"></a>
## 模型体验

间接通过应用绑定授权策略的评估消费者产生影响。

#### KV Cache 影响

无直接影响；scope decision 只有通过消费者纳入授权评估结果后才会进入模型。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 提供方不授予目标或操作；挂载的 scope 仍是授权来源。
- Session 绑定不能超过拥有它的 scope 或 Session 提供方的生命周期。

不发布 runtime invariant companion，因为除 scope 和 Session 服务外，本提供方没有独立投影。

<a id="dev-note"></a>
### 开发备注

在服务边界保持授权引用和带品牌的 id 类型。
