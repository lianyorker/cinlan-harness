---
description: "由 Host 持久化、由当前 Client 消费的通知偏好。"
kind: "package-group"
---

# notifications/ — 通知偏好

[English](README.md) | 中文

## 概述

`notifications/` 包组拥有持久化的通知设置命名空间。浏览器权限、声音播放与通知投递由当前 Client 负责。

## 目录

- [包](#package)
- [相关文档](#related-documentation)

<a id="package"></a>
## 包

| 包 | 职责 |
|---|---|
| [notifications/](notifications/README.zh.md) | 通知偏好的 Host 登记与校验，包括免打扰时段 |

<a id="related-documentation"></a>
## 相关文档

- [Settings 子系统参考](../../docs/subsystems/settings.zh.md) — 命名空间登记、持久化及带版本检查的写入。
- [通知设置与投递](../client/ui-notifications/README.zh.md) — 浏览器权限、自动提醒和显式测试。
