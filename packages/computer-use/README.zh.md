---
description: "Computer Use 能力包：Service Definition、原生 Provider、权限策略和工具。"
kind: "package-group"
---

# Computer Use

[English](README.md) | 中文

## 概述

通过独立的 device-control profile 组合本地设备能力；普通 web profile 不自动启用设备输入。
计算机操作提供方让模型观察并操作桌面。本组包含共享注册器，防止同一组合同时启用多个提供方。DSH 的 [CUA 实现](../experimental/cua/README.zh.md)、平台提供方和启用组合包目前位于 `experimental`，Cua Driver 适配包也位于该组。CUA 包文档说明了迁入本组所需的平台支持条件。

## 包

| Package | Role |
|---|---|
| [computer-use](computer-use/README.zh.md) | Service Definition |
| [computer-use-permission-policy](computer-use-permission-policy/README.zh.md) | Permission Consumer |
| [tool-computer-use](tool-computer-use/README.zh.md) | Tool Consumer |

## 相关文档

- [Device control](../../docs/subsystems/device-control.zh.md)
- [计算机操作](../../docs/subsystems/computer-use.zh.md) — 能力归属和提供方选择。
- [Computer Use 组合包](../experimental/cua-bundle/README.zh.md)：启用原生 CUA 并使用权限管理功能。
- [实验性包](../experimental/README.zh.md)：原生 CUA 包和 Cua Driver 适配包。

## Dev Note

平台执行、认证和设备可用性由所选 Provider 及其部署环境负责；包存在不代表设备已就绪。
