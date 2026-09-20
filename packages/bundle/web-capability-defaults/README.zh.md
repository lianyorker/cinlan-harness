---
description: "Web 与 Desktop profile 组合的提供方启用默认值。"
kind: "package-bundle"
---
# Web capability defaults

[English](README.md) | 中文

## 摘要

本纯配置 bundle 让已配置的 Browser 与 Computer Use 提供方保持禁用，直到用户启用。它包含两个补丁，没有插件入口。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

默认 Web 与 Desktop profile 在 [Browser](../cinlan-browser/README.zh.md) 和 [Computer Use](../cinlan-computer-use/README.zh.md) 之后、用户补丁之前应用本 bundle。它将 `browser-playwright` 与 `computer-use-cua-driver-native` 设为 `disabled: true`；不插入条目，也不改变提供方配置。服务、资源管理、权限策略和设置仍在组合中。

通过设置与官方插件管理器启用已配置的提供方。其 profile 补丁位于本 bundle 之后，因此 `disabled: false` 覆盖随附默认值。更后的 home 或命令行补丁仍可覆盖该选择。启用提供方不授予动作权限，也不证明浏览器或原生运行时就绪。

显式 `browser` 和 `device-control` profile 不包含此层，保留其已启用提供方。移动设备组合不受影响。

<a id="model-experience"></a>
## 模型体验

#### 模型看到什么

只有活跃提供方与消费者注册的工具。本 bundle 不贡献模型可见文本。

#### Token 影响

不直接产生 token；启用提供方可能暴露其工具。

#### KV Cache 影响

不直接改变前缀；活跃工具目录决定下游变化。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

两个目标条目必须已经存在。本 bundle 仅提供启用默认值；提供方安装、资源完整性、就绪状态和动作授权仍由各自所有者负责。不发布运行时 invariant 伴随插件，因为本包只应用两个 Loader 补丁，不持有运行时状态。

## 开发者说明

[原生 CUA 决策](../../../.agents/notes/implemented/architecture/2026-09-20-native-cua-readiness-and-policy.zh.md) 记录默认组合与用户启用的归属。
