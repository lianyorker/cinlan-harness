---
description: "桌面通知偏好的 Host 设置命名空间。"
kind: "package-reference"
---

# @deepseek-ai/dsh-notifications

[English](README.md) | 中文

## 概述

跨主机重启保存桌面通知偏好：总开关、agent（智能体）完成通知、终端响铃、声音、专注抑制和每日免打扰时段。通过[通知设置页面](../../client/ui-notifications/README.zh.md)配置这些偏好，该页面也负责浏览器投递。

## 目录

- [使用](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用

```yaml
- name: '@deepseek-ai/dsh-settings-file'
- name: '@deepseek-ai/dsh-notifications'
```

`notifications` 命名空间默认关闭所有开关，声音为 `system`，免打扰时段为 `22:00` 至 `08:00`。主机会在持久化前将两个时间校验为 24 小时制 `HH:mm` 字符串。客户端按本地时区解释：包含开始时刻，不包含结束时刻；开始晚于结束时跨越午夜；起止相同则全天抑制自动提醒。显式测试操作绕过免打扰和专注抑制，但仍遵循总开关和浏览器权限检查。

设置 provider 在同一版本校验写入中持久化两个时间。版本过期或时间无效会拒绝整笔操作。重置会移除用户覆盖，使 schema 默认值重新生效。本插件是唯一登记所有者；页面通过 `ctx.settingsScope` 读写。移除所有者会注销命名空间，但不删除持久化的原始值。`/types` 入口仅包含偏好数据类型；运行时默认值归 [schema](src/settings.ts) 所有。

<a id="model-experience"></a>
## 模型体验

无，因为通知命名空间只登记浏览器偏好，不改变模型提示词或工具结果。

#### KV Cache 影响

本包不增加或改写模型上下文，偏好更新因此不影响请求前缀缓存。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

- Host 登记不直接调用操作系统通知 API；当前客户端运行时负责其环境中的通知投递。

<a id="dev-note"></a>
### 开发备注

本包不发布 invariant 配套入口：它仅拥有一项绑定 effect 的 schema 登记，没有需要比较的独立运行时观测关系。[设置所有权决策](../../../.agents/notes/implemented/architecture/2026-09-17-native-settings-runtime-consumers.zh.md)记录免打扰语义，以及 Host 持久化与 Client 投递之间的职责划分。
