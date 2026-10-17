---
description: "默认请求审批的移动设备 profile bundle。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-cinlan-mobile-device

[English](README.md) | 中文

## 概述

默认请求审批的移动设备 profile bundle。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)

<a id="use-this-package"></a>
## 使用本包

该 bundle 为完整 Cinlan Mobile Device capability family 导出 `cordis.patch.yml`。Profile 在 `dsh-base` 之后应用一次；随附 Web 和 Desktop 组合包含它。自定义 profile（包括 headless profile）可以显式选择它。

Patch 挂载 provider-neutral Service Definition、原生资源管理器、原生 Android ADB Provider、权限策略 Consumer 和五个模型工具。它固定 Provider id `adb`，并把 `observe`、`touch`、`textInput` 和 `deviceNavigation` 配置为 `ask`。挂载不会安装 Android 资源或启动镜像；这些操作需要人手动执行。[Mobile Device 偏好](../../mobile-device/mobile-device/README.zh.md#saved-preferences)通过 Settings 实时更新。

<a id="model-experience"></a>
## 模型体验

### Profile 组合

#### 模型看到什么

策略批准后，模型会收到 Mobile Device guidance 和五个 `mobile_*` schema。没有这个 patch 时，这些工具和 prompt section 都不存在。

#### Token 影响

启用 bundle 会增加工具 Consumer 的稳定 guidance 与 schema，以及逐调用 result。

#### KV Cache 影响

选择该 bundle 的 profile 会改变 request prefix；其固定 patch order 在 session 之间保持稳定。

## 已知限制与延后工作

- Bundle 需要已有 Android ADB 安装与经过授权的设备；支持物理 Android 手机和模拟器，不支持 iOS。Provider 配置、SDK 路径、输入与清理限制见[原生 ADB Provider](../../mobile-device/mobile-device-adb/README.zh.md)。

不发布 runtime invariant companion：Provider 注册、协议校验和 observation 新鲜度由各自操作执行，并由包级测试覆盖。

### 开发备注

无。
