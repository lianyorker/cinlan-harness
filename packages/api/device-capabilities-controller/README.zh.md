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

与 Typert registry 一起挂载此控制器。Computer Use 和 Mobile Device 服务为可选项；缺失时返回 not-configured。桌面检查调用 capabilities；移动设备检查调用 listDevices，在没有可用设备时返回 no-devices。响应不包含应用名称、设备 id、命令路径或 Provider 原始错误。

<a id="model-experience"></a>
## 模型体验

无。此控制器不注册模型工具、prompt 或 Session event。

#### KV Cache effect

无；就绪状态不进入模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 就绪状态仅代表当前传输探测结果，不代表动作授权或全部桌面权限已授予。调用方取消会传播到 Provider。CLI 安装、认证和原生权限仍是外部前置条件。

不发布 runtime invariant companion：控制器返回即时结果，不保留与 Provider 独立的状态。

### 开发备注

状态定义见 [types.ts](src/types.ts)。
