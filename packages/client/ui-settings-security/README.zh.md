---
description: "在设置中配置手机模拟器设备能力。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-security

[English](README.md) | 中文

## 摘要

设置里只保留一个能力页面：手机模拟器。它编辑已保存的设备偏好、报告服务提供者的探测结果、列出面向模型的移动工具，并以显式动作管理 Android 运行资源。页面不安装任何软件，也不执行设备输入；每次安装、许可证接受与镜像启动都是人的显式动作，并保留 Host 的权限检查。

## 目录

- [使用本包](#use-this-package)
- [设置与动作归属](#settings-and-action-ownership)
- [开发者说明](#dev-note)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

与 Settings、Locale 以及 deviceCapabilities、settings Remote 一起挂载。可选的 pluginManager Remote 提供智能体卡片渲染的条目启停控件；缺失时卡片报告管理不可用，同时仍然显示探测与资源状态。能力缺失时导航条目保留。`mobile-registration.ts` 拥有作用域绑定、资源观察器、探测与销毁；`capability-registration.ts` 与 `capability-shared.ts` 承载分区注册与提供者启停回调；`CapabilitySection.tsx` 渲染页面。装配只贡献共享语言词典并挂载这一个功能 fiber。

<a id="settings-and-action-ownership"></a>
## 设置与动作归属

| 区域 | 存储字段与运行消费者 |
|---|---|
| 移动设备 | [移动设备能力](../../mobile-device/mobile-device/README.zh.md) 拥有 `mobile-device` 命名空间。`enabled` 控制本页自动检查，`androidSdkPath` 提供给 Host 检查与原生 ADB 操作，`defaultDeviceId` 仅在 `mobile_observe.device_id` 未指定时使用。页面把手机模拟器整理为一张设置卡——检查开关、带状态徽标与重新检查的可用性、含下载/使用检测到/清除动作的 Android SDK 行、自定义 SDK 路径、默认设备——随后是智能体卡片：以 0/2 徽标把能力条目与工具条目列为两步，列出启动命令与 `mobile_*` 工具名，并提供三条可复制示例提示。 |
| 运行资源 | [移动运行资源管理器](../../mobile-device/mobile-device-runtime/README.zh.md) 拥有 Platform Tools、scrcpy 与原生镜像进程。安装、重新安装和更新均要求显式接受许可证并提交显示的资源修订号；移除需要确认。取消针对已观察到的任务 ID。镜像要求明确选择可用 Android 设备；关闭针对所属镜像 ID。镜像进程运行不证明画面已显示。 |

可用性与工具链行是只读的：提供者探测、SDK 检查与设备列表都不写偏好。只有开关、SDK 路径和默认设备参与草稿表单，并通过一次原子修改按草稿打开时的修订号保存。页面仅在挂载期间观察 Host；`runtimePollIntervalMs` 默认为 1000 毫秒，允许 100–60000 毫秒。离页停止观察，不取消 Host 任务或关闭镜像。

设置卡复制受支持的 `dsh --profile device-control` 命令。剪贴板被拒绝时显示失败信息。

<a id="dev-note"></a>
## 开发者说明

页面本身不拥有能力：它投影移动能力的存储偏好、Host 设备探测与运行资源管理器的资源状态。提供者仍是独立插件，因此本包可以从组合中省略而不移除该能力。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 自定义 SDK 路径是文本字段：页面没有原生目录选择器，需要手动输入或粘贴路径。
- 页面只报告 Host 发布的资源与镜像状态；镜像进程运行不证明画面已显示。
