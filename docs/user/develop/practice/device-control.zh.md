# 本地设备控制

[English](device-control.md) | 中文

## 概述

使用 `device-control` profile，通过 Harness 工具与审批观察和操作桌面窗口，或已授权的 Android 手机与模拟器。桌面控制使用原生 CUA；移动控制使用已有 Android ADB 安装。

## 目录

- [前置条件](#prerequisites)
- [启动 profile](#start-the-profile)
- [选择 Android 工具与设备](#select-android-tools-and-a-device)
- [验证就绪状态](#verify-readiness)
- [限制](#limits)

<a id="prerequisites"></a>
## 前置条件

使用包含 device-control profile 的构建。[原生 CUA](../../../../packages/experimental/computer-use-cua-driver-native/README.zh.md)需要随包提供的原生依赖、图形桌面会话和启动应用的操作系统权限；它不要求 Orca 应用或 CLI。

Android 控制需要已有[官方 platform tools](https://developer.android.com/tools/releases/platform-tools)，以及在线且已授权的 Android 手机或模拟器。实体手机需要启用 USB 调试并授权此 Host。离线与未授权设备保持不可用。此 Provider 不支持 iOS。

<a id="start-the-profile"></a>
## 启动 profile

在不请求设备输入或模型应答的情况下检查组合：

```sh
dsh --profile device-control --dump-config
```

启动其 Web 界面：

```sh
dsh --profile device-control
```

此 profile 使用标准 Harness 启动器，包含原生 Computer Use 和 Mobile Device bundle。启动 profile 不会安装 Android 工具或授予输入权限。

<a id="select-android-tools-and-a-device"></a>
## 选择 Android 工具与设备

移动设备设置中保存的 Android SDK 路径接受绝对 SDK 根目录、`platform-tools` 目录或 `adb` 可执行文件。Provider 配置的 `command` 优先于该保存路径；两者均为空时，Provider 使用 PATH 上的 `adb`。[原生 ADB README](../../../../packages/mobile-device/mobile-device-adb/README.zh.md)负责部署配置与执行限制。

选择精确的 `android:<serial>` 设备。仅当观察请求省略目标时才使用保存的默认设备；默认设备缺失、歧义或不可用时，绝不选择其他设备。Provider 在输入前验证设备 transport。

<a id="verify-readiness"></a>
## 验证就绪状态

打开设置 → 计算机控制或移动设备，检查就绪状态。桌面工具目录就绪不证明操作系统访问可用，也不授予审批。ADB 可执行文件检查成功不证明设备已连接；移动设备就绪还要求存在可用设备。没有设备即表示设备控制不可用。发现设备可能启动共享 ADB server。

原生桌面工具与所有移动观察／输入类别默认请求审批。操作前观察精确目标，操作后通过新状态验证。移动修改会消耗一次性 observation token，因此下一次输入或重试前必须重新观察。

<a id="limits"></a>
## 限制

Android Provider 不安装或启动模拟器、不管理 SDK 下载与版本，也不启动 scrcpy 镜像。SDK 与镜像管理需要独立实现。原生文本输入仅支持受限的字面安全 ASCII 字符集；不支持的文本会明确失败。详见 [Provider 限制](../../../../packages/mobile-device/mobile-device-adb/README.zh.md#known-limitations-and-deferred-work)。

无设备时的清单检查成功，不验证硬件上的层级捕获、截图或输入。依赖这些操作前，请在授权目标上验证。[设备控制](../../../subsystems/device-control.zh.md)说明就绪状态与生命周期语义。
