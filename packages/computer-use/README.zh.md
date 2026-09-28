---
description: "Computer Use 能力包：Service Definition、原生 Provider、权限策略和工具。"
kind: "package-group"
---

# Computer Use

[English](README.md) | 中文

## 概述

通过独立的 device-control profile 组合本地设备能力；普通 web profile 不自动启用设备输入。

## 包

| Package | Role |
|---|---|
| [computer-use](computer-use/README.zh.md) | Service Definition |
| [computer-use-permission-policy](computer-use-permission-policy/README.zh.md) | Permission Consumer |
| [tool-computer-use](tool-computer-use/README.zh.md) | Tool Consumer |

## 相关文档

- [Device control](../../docs/subsystems/device-control.zh.md)

## Dev Note

平台执行、认证和设备可用性由所选 Provider 及其部署环境负责；包存在不代表设备已就绪。
