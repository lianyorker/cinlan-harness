---
description: "deviceCapabilities/check Remote 探测可选的 Computer Use 或 Mobile Device Provider，不安装软件、不执行输入。接口返回脱敏后的就绪状态，不把 Loader 激活当作安装证明。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-device-capabilities-controller

[English](README.md) | 中文

## 概述

deviceCapabilities/check Remote 探测可选的 Computer Use 或 Mobile Device Provider，不安装软件、不执行输入。接口返回脱敏后的就绪状态，不把 Loader 激活当作安装证明。

## 目录

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

与 Typert registry 一起挂载此控制器。Computer Use 和 Mobile Device 服务为可选项；缺失时返回 not-configured。桌面检查调用 `readiness(signal)`；移动设备检查调用 listDevices，在没有可用设备时返回 no-devices。响应不包含应用名称、设备 id、命令路径或 Provider 原始错误。

可选的 `computer` 响应以 `kind` 区分。`tool-catalog` 返回 Provider、平台、生命周期状态、只读工具名称和 `permissions: unknown`；`ready` 表示可用，原生 Provider 仅在目录非空时发布该状态。其他状态报告 `provider-initializing`、`provider-disposing` 或 `provider-failed`。`facade` 保留平铺的 platform、provider、providerVersion、protocolVersion、supports 和 permissions 字段。两者都不虚构 CUA 动作能力描述符。

`checkSdk` Remote 通过已挂载的 subprocess provider 执行 `adb version`，并在 macOS 上执行 `xcrun simctl help`。保存的 `mobile-device.androidSdkPath` 非空时，选择该绝对路径中的 `platform-tools/adb` executable（Windows 上为 `adb.exe`）；配置路径失败时不会回退到其他 SDK。路径为空时搜索 `ANDROID_HOME`、`ANDROID_SDK_ROOT` 和常用 SDK 位置。检查成功要求退出码为零、没有终止信号，且输出完整并符合上限。executable 缺失、启动失败、非零退出、输出溢出及超时均报告不可用，不暴露进程输出。调用方取消会在托管进程范围清理完毕后传播；控制器卸载会取消并等待所有未完成检查。

| 配置字段 | 默认值 | 含义 |
|---|---:|---|
| `probeTimeoutMs` | 5,000 | 单次 SDK 检查的 executable 查找与命令共用的截止时间 |
| `probeGraceMs` | 1,000 | 托管进程终止与输出排空的宽限时间 |
| `maxProbeOutputBytes` | 65,536 | stdout 或 stderr 各自保留的最大字节数 |

这些上限均为不大于 2,147,483,647 的正整数。截止时间到达后请求终止进程；请求在进程清理完毕后才结束。缺少 subprocess provider 时报告 SDK 不可用。独立的 `listMobileDevices` Remote 仅枚举 Provider 的设备并返回设备 id、名称、状态和可用性，不观察或控制设备。

<a id="model-experience"></a>
## 模型体验

无。此控制器不注册模型工具、prompt 或 Session event。

#### KV Cache effect

无；就绪状态不进入模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 就绪状态报告某一时刻的目录生命周期或 facade 探测结果，不授权动作，也不验证操作系统授权。原生 CUA 权限保持 unknown，其随包 SDK 无需外部 CLI。facade 传输保留各自前置条件。调用方取消会传播到 Provider。
- 保存的 SDK 路径仅控制本地 SDK 检查。Mobile Device Provider 使用的公开 CLI 不支持覆盖外部 Cinlan 设备运行时的 SDK；SDK 检查不会配置该运行时。

不发布 runtime invariant companion：控制器返回即时结果，不保留与 Provider 独立的状态。

### 开发备注

状态定义见 [types.ts](src/types.ts)。
