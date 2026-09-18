---
description: "使用归一化坐标和可选截图的模型移动设备工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-mobile-device

[English](README.md) | 中文

## 概述

使用归一化坐标和可选截图的模型移动设备工具。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)

<a id="use-this-package"></a>
## 使用本包

这个 Consumer 在 [`ctx.mobileDevice`](../mobile-device/README.zh.md) 之上注册五个面向模型的工具。它拥有严格 model-input validation、简洁 result 呈现、可选 PNG 持久化和稳定 system guidance。

| 工具 | 行为 |
|---|---|
| `mobile_list_devices` | 列举 canonical 的精确 device id 与 availability |
| `mobile_observe` | 观察显式指定的设备或已保存的默认设备；返回新的、一次性的 observation、tree text 和可选原生 PNG attachment |
| `mobile_touch` | 使用归一化 `0..1` 坐标执行 tap 或 swipe |
| `mobile_type` | 输入有界字面文本，但不在 result 中回显 |
| `mobile_button` | 按下一个 Provider 支持的设备导航按钮 |

只有 deployment attachment policy 接受 PNG，且精确 routed Provider 与 model 解析为原生 image input 时，`mobile_observe` 才请求 screenshot。接受的图片使用 Computer Use 所用的 attachment-backed `ImageBlock` 路径，绝不经过 MCP。即使 capture 被跳过、失败或 image persistence 失败，tree text 仍然可用。

只有 `mobile_observe` 允许省略 `device_id`：Mobile Device 服务将已保存的默认设备解析为当前可用的精确设备，不会回退。显式 id 优先；空 id 和首尾空白均无效。每次 mutation 都需要观察结果返回的精确 `device_id` 和最新 `observation_id`。Tap 与 swipe field 相互排斥，坐标必须是从 `0` 到 `1` 的有限闭区间值；成功 result 会要求模型重新 observe，但不会回显 typed text。

<a id="model-experience"></a>
## 模型体验

### 工具可见状态

#### 模型看到什么

对于 `mobile_observe`，模型会看到实际解析的设备 metadata、generation 与 observation id、归一化 coordinate space、有界 tree text、显式 screenshot status 和可选原生 image block。解析后的设备 id 也会持久化到呈现 metadata，让完成后的卡片在回放时显示相同目标。Mutation result 只包含 target identity 和 fresh-observe requirement。

#### Token 影响

稳定 guidance 与五个 schema 增加 request token。Device tree 和 rendered result 增加 result token；可选图片使用 Provider 的原生 image accounting。

#### KV Cache 影响

同一工具配置下的静态 guidance 与 schema 保持稳定，绝不嵌入已保存的设备偏好。Device observation 和 image 属于逐调用 result content，不改变 request prefix。

## 已知限制与延后工作

- Consumer 不暴露 install、launch、设备生命周期、运行时权限、日志、文件、raw execution、相机、传感器、剪贴板或远程 pairing 工具。

不发布 runtime invariant companion：Provider 注册、协议校验和 observation 新鲜度由各自操作执行，并由包级测试覆盖。

### 开发备注

无。
