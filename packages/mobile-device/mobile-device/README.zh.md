---
description: "移动设备 Provider 注册表及观察、输入请求。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mobile-device

[English](README.md) | 中文

## 概述

移动设备 Provider 注册表及观察、输入请求。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)

<a id="use-this-package"></a>
## 使用本包

这个 Service Definition 拥有 provider-neutral 的 `ctx.mobileDevice` registry 与执行 facade。Provider 负责设备发现、精确设备标识、runtime generation、observation token、tree text、可选的已校验 PNG bytes 和 mutation；Consumer 负责权限策略、模型 schema、attachment 持久化和呈现。

## Provider 选择

可选的 `provider` 配置固定一个 Provider id。省略时，每次调用都选择唯一可用的 Provider。缺失、不可用、不存在、歧义、空白或重复的 Provider 都通过结构化 `MobileDeviceError` code 失败，不做隐式选择。

## 标识与 observation

`MobileDeviceId` 是 opaque 的精确 selector。`MobileDeviceGeneration` 标识一个 Provider 报告的设备实例，`MobileObservationId` 是 opaque 的一次性 token。每次 mutation 都需要精确 device id 和最新 observation id；Provider 在 dispatch 前消费 token，无论成功或失败，调用方随后都必须重新 observe。

Touch request 使用从 `0` 到 `1` 的归一化坐标。服务只公开设备列举、观察、tap 或 swipe、字面文本输入和设备导航按钮。

<a id="model-experience"></a>
## 模型体验

### Consumer 拥有结果

#### 模型看到什么

本 package 不直接贡献模型文本。[`@deepseek-ai/dsh-tool-mobile-device`](../tool-mobile-device/README.zh.md) 呈现结果，并通过普通 tool-result 路径保留 `MobileDeviceError` failure。

#### Token 影响

Service Definition 不增加 request 或 result token；这些成本由面向模型的 Consumer 拥有。

#### KV Cache 影响

Provider 注册、选择和 observation state 不会改变模型 request prefix。

## 已知限制与延后工作

- 服务没有持久设备记录、远程 pairing、Execution Host 绑定或 emulator 生命周期所有权。
- 初始 API 不包含应用管理、运行时权限、logcat、文件传输、raw execution、相机、传感器、剪贴板以及设备 boot 或 shutdown。

不发布 runtime invariant companion：Provider 注册、协议校验和 observation 新鲜度由各自操作执行，并由包级测试覆盖。

### 开发备注

无。
