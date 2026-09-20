---
description: "管理安全研究技能、配置浏览器偏好，并检查桌面及移动设备的就绪状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-security

[English](README.md) | 中文

## 概述

在设置中配置浏览器启动偏好和链接路由，并检查桌面与移动设备就绪状态。安全研究管理已安装技能资源、版本、来源及显式安装/更新/移除操作。移动设备设置保留现有 Host 偏好，并说明哪些值尚无设备操作消费者。显式操作保留 Host 权限检查；打开页面不会安装软件或执行设备输入。

## 目录

- [使用本包](#use-this-package)
- [设置与操作归属](#settings-and-action-ownership)
- [开发笔记](#dev-note)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

与 Settings、Locale 以及 pluginInventory、deviceCapabilities、securityResearch、browser 和 settings Remote 一起挂载。可选 pluginManager Remote 提供条目启停控制。能力缺失时，安全研究、浏览器、计算机控制和手机模拟器导航分区仍然可见。安全研究明确显示资源管理组件缺失，不读取或切换 Agent 预设。插件加载、Provider 就绪和动作授权是不同事实。

计算机控制与移动设备页面复制受支持的 `dsh --profile device-control` 命令。它启动独立 profile，不会安装外部软件。剪贴板拒绝写入时显示失败提示。

<a id="settings-and-action-ownership"></a>
## 设置与操作归属

| 页面 | 存储字段与运行消费者 |
|---|---|
| 浏览器 | `browser-playwright` 存储浏览器渠道、无窗口模式、视口宽高、配置名、主页和搜索引擎。浏览器启动消费渠道/无窗口/视口/配置名；主页和搜索操作消费各自偏好。重启当前 profile 后应用改动。 |
| 浏览器链接路由 | 侧边栏在 `dsh-better-sidebar` 中拥有 `browserInterceptLinks`、`browserInterceptHttp` 和 `browserInterceptHttps`。GUI 与终端超链接独立于 Browser Provider 使用这些设置。保存只发送更改的路由字段；重置只移除它们的覆盖，保留其他侧边栏偏好。 |
| 移动设备 | [移动设备能力](../../mobile-device/mobile-device/README.zh.md) 拥有 `mobile-device` 命名空间。`enabled` 控制本页自动检查，`androidSdkPath` 提供给 Host 检查与原生 ADB 操作，`defaultDeviceId` 仅在 `mobile_observe.device_id` 未指定时使用。 |
| 安全研究 | [安全技能资源管理器](../../security/security-skills/README.zh.md) 拥有安装与后台任务。本页通过 securityResearch Remote 显示其快照和进度。技能在正常会话中使用；页面不提供范围编辑器、扫描控制台或报告导出。 |
| 计算机控制 | 原生 CUA 报告工具目录生命周期、已注册工具和平台；facade 服务提供者报告版本和声明的支持标志。目录就绪不证明截图访问、输入送达或系统权限。不提供屏幕、指针或缩放偏好。 |

浏览器、计算机控制与移动设备启停区域列出精确配置的 Playwright、原生 CUA 或原生 ADB Loader 条目，包括停用的条目。官方插件管理器拥有持久化、只读限制和应用结果。请求等待期间禁止重复提交；拒绝、失败、覆盖、取消和需要重启的结果保持可见。每次请求后重新读取 Host 状态，不根据请求值推断启用成功。启用不会启动浏览器或批准桌面动作。

浏览器与移动设备运行资源与偏好及显式控制并列保留。页面仅在挂载期间观察 Host；runtimePollIntervalMs 默认为 1000 毫秒，允许 100–60000 毫秒。离页停止观察，不取消 Host 任务或关闭镜像。[原生 CUA 就绪状态与权限策略](../../../.agents/notes/implemented/architecture/2026-09-20-native-cua-readiness-and-policy.zh.md) 定义独立的工具目录与权限事实。

浏览器与移动设备表单读取框架绑定的 SettingsScope 快照。草稿保留首次编辑修订号，每个表单通过一次原子修改保存。重置移除用户覆盖，恢复组合默认值。仅成功的 Host 响应更新共享镜像并显示成功；写入拒绝时保留草稿。只读或不可用设置不能保存或重置。

[Mobile 运行资源管理器](../../mobile-device/mobile-device-runtime/README.zh.md)拥有 Platform Tools、scrcpy 与原生镜像进程。安装、重新安装和更新均要求显式接受许可证并提交显示的资源修订号；移除需要确认。取消针对已观察到的任务 ID。镜像要求明确选择可用 Android 设备；关闭针对所属镜像 ID。镜像进程运行不证明画面已显示。

移动设备 SDK 与设备列表读取各自具有加载、失败和重试状态，离开视图时取消。Host SDK 检查读取已保存路径，执行只读 `adb version` 探测；未保存的编辑不影响检查。已保存但缺失或离线的设备保持选中，直到用户更改。`mobile_observe` 仅在未指定显式设备时使用已保存默认值；默认设备不可用时失败，不回退到其他设备。设备修改仍要求精确设备和观察令牌。开启自动检查不授予动作权限，手动检查不保存偏好，也不安装工具。

显式浏览器连接、主页/搜索、历史/网络检查、Cookie 文件导入和文件传输使用 browser Remote。挂载页面或保存偏好不会启动浏览器。Cookie 不显示值；下载使用 inert Blob，离开所属视图时释放 URL。文件传输保留在详情面板中，已选择页面时搜索导航会展开该面板。

未配置网络发行源时，安全研究提供“安装内置资源”，并解释网络下载不可用的原因。已配置发行源时可下载、重新下载、检查更新，并在版本不同时更新。移除操作需要确认。离页只退订进度，不取消 Host 任务；只有“取消任务”发送已观察到的任务 id。失败保留已提交的安装，并提供显式重试。

原生风格标题和设置行继承设置壳层的宽度。搜索仅索引本地化公共标题、说明与关键词，不包含偏好值、设备标识、范围内容、凭证或报告。描述符与页面 slot 共享声明生命周期。不可用状态仍保留可识别的搜索目标；搜索目标为组件诊断时展开详情，不发起新的操作动作。

-----

<a id="dev-note"></a>
## 开发笔记

[包测试](tests/) 覆盖元数据生命周期和本地化、偏好修订号约束与重置、草稿拒绝、就绪失败、剪贴板反馈、浏览器操作，以及资源来源、确认、进度、重试与观察清理。不发布运行时 invariant companion：本包读取 Host 权威结果，仅保留 UI 草稿与视图状态。协议语义归 [Device control](../../../docs/subsystems/device-control.zh.md) 所有。

-----

<a id="model-experience"></a>
## 模型体验

无，因为查看或保存设置不会增加模型内容或 token，且本包不注册提示词、工具或 Session 事件；只有用户粘贴并发送时，可复制提示词才会进入模型。

#### KV Cache 影响

无；偏好与就绪读取不会进入模型请求前缀。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- 插件加载不证明就绪，Provider 探测成功也不授予操作权限。原生 Android 操作要求已授权的连接设备；安装资源与空设备列表不能验证截图或输入送达。
- Provider 显式配置的可执行文件优先于保存的 SDK 路径。保存路径优先于已验证的托管 Platform Tools 与 PATH。不提供 iOS 设备控制或模拟器安装。
- 捕获内容、浏览器缩放和计算机控制偏好需要各自的运行 owner；本包不添加仅供预览的字段。
- 网络下载要求 Host 配置真实发行源。安装技能不授予网络、文件或工具权限；范围和发现记录仍由后端拥有。
