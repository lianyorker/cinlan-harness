---
kind: upgrade-guide
description: "Web 和 Desktop 内置 Mobile Device，移动偏好使用实时 profile Config。"
---

# 内置移动设置

[English](guide.md) | 中文

## 变更

Web 和 Desktop 包含 `@deepseek-ai/dsh-cinlan-mobile-device`，提供原生 ADB 发现、Android 资源管理以及受审批约束的模型工具。启动不会安装 SDK 或打开镜像。本版本的标准 Web 组合包列表会规范化到当前模板；自定义组合包列表保持不变。

`mobile-device` 条目将 `enabled`、`androidSdkPath` 和 `defaultDeviceId` 暴露为 volatile Config 字段。Settings 写入 profile 的 `cordis.patch.yml`；运行时读取这些实时值，而非已移除的 Settings 文档。`enabled` 是检查偏好，不是设备授权。资源和镜像控制器调用需要 Connection operator 的 Remote invocation；缺少该身份的直接调用会被拒绝。

## 迁移

1. 重启标准 Web profile。已有的自定义 Web 或 Desktop profile，需要在其 `package.json` 的 `dsh.profile.bundles` 中包含且仅包含一次 `@deepseek-ai/dsh-cinlan-mobile-device`；已有条目保留，不要重复添加。
2. 移除与组合包重复的手动移动条目。部署修改保留为按 id 定位的 patch；选择该 Provider 时，`mobile-device` Config 覆盖应保留 `provider: adb`。
3. 在 Settings 打开 Mobile Emulator，选择 SDK 目录，或手动输入后移开焦点以保存。确认重新打开页面后值仍存在，且 profile patch 中的 `mobile-device` Config 包含该值。条目处于启用状态时，Settings 会导入已有旧版 Settings 值。
4. 通过已认证 Gateway 调用资源与镜像 Remote。需要直接管理的 Host 集成使用 `ctx.mobileRuntime`，不要在缺少 Remote 身份时直接调用控制器方法。
