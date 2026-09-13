---
description: "使用一次性移动设备 observation token 的本地 CLI Provider。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mobile-device-cinlan

[English](README.md) | 中文

## 概述

使用一次性移动设备 observation token 的本地 CLI Provider。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)

<a id="use-this-package"></a>
## 使用本包

这个 Service Provider 通过公开的 Cinlan IDE JSON CLI 实现 [`ctx.mobileDevice`](../mobile-device/README.zh.md)。每次操作都通过 `ctx.subprocess` 启动一个显式 argv，校验完整 response，对 stdout、stderr、tree、image 和 text 应用有界限制，并且绝不调用 shell。

插件设置会立即注册 Provider，不解析 executable 也不探测设备列表。executable 解析和首次 CLI 调用在首次操作时懒执行，因此 Cinlan IDE CLI 缺失或未就绪不会阻断插件树。默认 executable 在 Windows 与 macOS 上是 `orca`，在 Linux 上是 `orca-ide`；显式 `command` 可以选择其他 bare name 或绝对路径。

## 公开命令

| Mobile Device 操作 | 配置 executable 之后的 CLI argv |
|---|---|
| `listDevices` | `emulator devices --json` |
| `observe` | `emulator observe --device <deviceId> [--no-screenshot] --json` |
| tap | `emulator tap <x> <y> --device <deviceId> --observation-id <observationId> --json` |
| swipe | `emulator gesture <normalizedGestureJson> --device <deviceId> --observation-id <observationId> --json` |
| `typeText` | `emulator type --text-stdin --device <deviceId> --observation-id <observationId> --json`，字面文本通过 stdin 传递 |
| `pressButton` | `emulator button <button> --device <deviceId> --observation-id <observationId> --json` |

## Protocol 与 freshness

Devices result 是由 canonical `{backend,id,name,state,isAvailable,detail?}` record 组成的直接 array，并且 device id 唯一。Observation 要求 `protocolVersion: 1`、opaque `deviceGeneration`、opaque `observationId`、`coordinateSpace: normalized`、有界 tree text、显式 screenshot status，以及可选的有界 PNG；其尺寸必须与 IHDR header 一致。Tap、gesture、type 和 button result 必须恰好是 `{ok:true}`。

外层 `_meta.runtimeId` 是 Provider generation。Runtime replacement 会清空全部本地 observation。Provider 只保留每台设备的最新 observation，在 runtime probe 和 mutation dispatch 前消费它，向 CLI 传递精确 device id 与 observation id，并在严格 acknowledgement 成功后从已消费的 observation 构造公开 mutation result。

<a id="model-experience"></a>
## 模型体验

### 仅负责 transport 的 Provider

#### 模型看到什么

Provider 不直接贡献模型文本。它为 `mobile_observe` 返回 tree text 和可选 PNG bytes；`mobile_type` 输入文本不会出现在 argv 或 Provider summary 中。

#### Token 影响

Provider 本身不增加模型 token。

#### KV Cache 影响

CLI 执行和 observation state 不会改变模型 request prefix。

## 已知限制与延后工作

- Provider 不安装或启动应用，不管理设备生命周期，不授予运行时权限，不读取日志，不传输文件，不执行 raw command，不暴露相机或传感器，不使用剪贴板，也不配对远程设备。
- 真实 Android 与 iOS 行为取决于已安装的 Cinlan CLI，不属于 keyless unit coverage。

不发布 runtime invariant companion：Provider 注册、协议校验和 observation 新鲜度由各自操作执行，并由包级测试覆盖。

仅缓存成功的 executable 查询。安装或修复 PATH 后可重试失败的查询；调用方取消与插件卸载均会中止正在进行的查询。

### 开发备注

无。
