---
description: "在设置中配置手机模拟器设备能力。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-security

[English](README.md) | 中文

## 摘要

移动端伴侣是 Desktop/Web 共用的工作台页面，左侧入口位于自动化任务之后、工作区之前。工作台入口提供“获取应用程序、配对手机、已配对”三步向导；配对设置通过认证 Host 读取和保存机器名称、连接方式、内网地址、中枢地址与区域，并由 Host 生成有时效的 `cinlan://pair` 二维码与链接。手机模拟器仍是独立设置页，管理设备偏好、探测、常用命令和示例提示。

## 目录

- [使用本包](#use-this-package)
- [设置与动作归属](#settings-and-action-ownership)
- [开发者说明](#dev-note)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

伴侣页面拥有本地展示设置：显示开关会更新共享侧栏入口；机器名称、连接方式和中继状态由 Host 负责，二维码只在 Host 返回有效配对 offer 后在浏览器渲染。中继状态显示为连接中、已连接或未连接；已配对设备列表来自 Host，撤销会立即请求 Host 断开设备。

-----

<a id="use-this-package"></a>
## 使用本包

与 Settings、Locale 以及 deviceCapabilities、settings Remote 一起挂载。`companion-registration.ts` 注册移动端配对页面；`mobile-registration.ts` 拥有模拟器页面的作用域绑定与探测。页面不渲染插件启停或 Android 资源控件。

<a id="settings-and-action-ownership"></a>
## 设置与动作归属

| 区域 | 存储字段与运行消费者 |
|---|---|
| 移动设备 | [移动设备能力](../../mobile-device/mobile-device/README.zh.md) 拥有 `mobile-device` 命名空间。配置中的 `enabled` 控制本页自动检查，页面保留该值但不编辑。`androidSdkPath` 提供给 Host 检查与原生 ADB 操作，`defaultDeviceId` 仅在 `mobile_observe.device_id` 未指定时使用。设置区包含可用性、Android SDK 操作与默认设备，下方保留常用命令和可复制的示例提示。 |

可用性与工具链行是只读的。SDK 路径和默认设备在失焦时按草稿打开时的修订号保存。写入串行执行，排队的修改使用前一次写入接受的修订号。失败时保留草稿以便重试。离页取消检查并放弃排队写入，但不撤销已发送到 Host 的写入。

下载 Android Studio 指向 `https://developer.android.com/studio`。定位 SDK 文件夹使用组合提供的 `directory.picker` Factory：Browse 打开现有应用内目录浏览器，Native 使用 Desktop preload bridge 或 Host 选择器。确认目录、采用检测路径或清空路径后立即保存；取消时保留草稿。SDK 变更保存后重新检查。打开文件夹通过可选的 Session Remote 打开检测目录或显示其 ADB 可执行文件；未保存路径不提供打开操作。只读连接仍可刷新和打开文件夹，但不能更改偏好。

常用命令包含 `dsh --profile web` 和 `mobile_*` 工具。剪贴板被拒绝时显示失败信息。

<a id="dev-note"></a>
## 开发者说明

页面投影存储偏好与 Host 探测；省略本页不会移除底层能力或改变操作审批。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 未组合选择器时仍可手动输入 SDK 路径。原生文件夹打开需要 Session Remote 与经过验证的本地 Host 路径。
