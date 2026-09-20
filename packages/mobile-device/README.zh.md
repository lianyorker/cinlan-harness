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
| [mobile-device-adb](mobile-device-adb/README.zh.md) | 原生 Android Provider |
| [mobile-device-cinlan](mobile-device-cinlan/README.zh.md) | 可选旧 CLI Provider |
| [mobile-device-permission-policy](mobile-device-permission-policy/README.zh.md) | Permission Consumer |
| [tool-mobile-device](tool-mobile-device/README.zh.md) | Tool Consumer |

## 相关文档

- [Device control](../../docs/subsystems/device-control.zh.md)

## Dev Note

原生 Provider 通过已有 Android platform tools 发现与控制设备；包存在、ADB 可执行和设备已授权是不同事实。
