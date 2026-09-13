---
description: "移动设备观察和输入的审批与不可绕过的执行检查。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mobile-device-permission-policy

[English](README.md) | 中文

## 概述

移动设备观察和输入的审批与不可绕过的执行检查。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)

<a id="use-this-package"></a>
## 使用本包

这个 Consumer 为五个 Mobile Device 工具分配独立的 `allow | ask | deny` 决策。每个 class 默认都是 `ask`。

| Permission class | 工具 |
|---|---|
| `observe` | `mobile_list_devices`, `mobile_observe` |
| `touch` | `mobile_touch` |
| `textInput` | `mobile_type` |
| `deviceNavigation` | `mobile_button` |

策略参与 `tools/pre-execute` 以执行普通审批，并安装 monotonic `ctx.tools.guard()` 检查。prepend 或短路 listener 无法在不经过匹配策略路径时，把 `ask` 或 `deny` 决策变成可执行输入。

<a id="model-experience"></a>
## 模型体验

### 权限决策

#### 模型看到什么

被拒绝或未批准的 `mobile_*` 调用通过普通 tool error 路径返回已配置 class reason。允许的调用保留工具 Consumer 输出。

#### Token 影响

只有在决策阻止执行时，策略才增加 approval 或 denial message。

#### KV Cache 影响

权限决策不改变稳定 system prompt 或 tool schema。

## 已知限制与延后工作

- 策略只分类五个初始 Mobile Device 工具，不授予 Browser、Computer Use、shell、network 或设备生命周期权限。

不发布 runtime invariant companion：Provider 注册、协议校验和 observation 新鲜度由各自操作执行，并由包级测试覆盖。

### 开发备注

无。
