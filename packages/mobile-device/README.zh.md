---
description: "Mobile Device 能力包：Service Definition、CLI Provider、权限策略和工具。"
kind: "package-group"
---

# Mobile Device

[English](README.md) | 中文

## 概述

通过独立的 device-control profile 组合本地设备能力；普通 web profile 不自动启用设备输入。

## 包

| Package | Role |
|---|---|
| [mobile-device](mobile-device/README.zh.md) | Service Definition |
| [mobile-device-cinlan](mobile-device-cinlan/README.zh.md) | Provider |
| [mobile-device-permission-policy](mobile-device-permission-policy/README.zh.md) | Permission Consumer |
| [tool-mobile-device](tool-mobile-device/README.zh.md) | Tool Consumer |

## 相关文档

- [Device control](../../docs/subsystems/device-control.zh.md)

## Dev Note

平台执行、认证和设备可用性由外部 CLI 提供；包存在不代表设备已就绪。
