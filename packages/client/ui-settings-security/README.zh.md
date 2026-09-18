---
description: "配置浏览器偏好与安全评估范围，并检查桌面及移动设备的就绪状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-security

[English](README.md) | 中文

## 概述

在设置中配置浏览器启动偏好和链接路由，并检查桌面与移动设备就绪状态。安全研究提供预设和范围状态、经过授权的范围编辑器与报告下载。移动设备设置保留现有 Host 偏好，并说明哪些值尚无设备操作消费者。显式操作保留 Host 权限检查；打开页面不会安装软件或执行设备输入。

## 目录

- [使用本包](#use-this-package)
- [设置与操作归属](#settings-and-action-ownership)
- [开发笔记](#dev-note)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

与 Settings、Locale 以及 pluginInventory、deviceCapabilities、securityResearch、browser 和 settings Remote 一起挂载。能力缺失时，安全研究、浏览器、计算机控制和手机模拟器导航分区仍然可见。安全研究报告缺失或损坏的预设；预设可用之前，范围编辑器与导出保持不可用。插件加载、Provider 就绪和动作授权是不同事实。

计算机控制与移动设备页面复制受支持的 `dsh --profile device-control` 命令。它启动独立 profile，不会安装外部软件。剪贴板拒绝写入时显示失败提示。

<a id="settings-and-action-ownership"></a>
## 设置与操作归属

| 页面 | 存储字段与运行消费者 |
|---|---|
| 浏览器 | `browser-playwright` 存储浏览器渠道、无窗口模式、视口宽高、配置名、主页和搜索引擎。浏览器启动消费渠道/无窗口/视口/配置名；主页和搜索操作消费各自偏好。重启当前 profile 后应用改动。 |
| 浏览器链接路由 | 侧边栏在 `dsh-better-sidebar` 中拥有 `browserInterceptLinks`、`browserInterceptHttp` 和 `browserInterceptHttps`。GUI 与终端超链接独立于 Browser Provider 使用这些设置。保存只发送更改的路由字段；重置只移除它们的覆盖，保留其他侧边栏偏好。 |
| 移动设备 | [移动设备能力](../../mobile-device/mobile-device/README.zh.md) 拥有 `mobile-device` 命名空间。`enabled` 控制本页自动检查，`androidSdkPath` 提供给 Host SDK 探测，`defaultDeviceId` 仅在 `mobile_observe.device_id` 未指定时使用。 |
| 安全研究 | `assessment-scope.root` 拥有授权身份、有效期、目标、主机、操作、排除项、证据策略、出口目的地和凭证引用。范围 owner 校验并应用提交的授权。 |
| 计算机控制 | 只读 Provider 检查报告平台、Provider/版本、协议和声明的支持标志。缺失的观察信息保持不可用，检查成功也不代表已探测操作权限。不提供屏幕、指针或缩放偏好。 |

浏览器与移动设备表单读取框架绑定的 SettingsScope 快照。草稿保留首次编辑修订号，每个表单通过一次原子修改保存。重置移除用户覆盖，恢复组合默认值。仅成功的 Host 响应更新共享镜像并显示成功；写入拒绝时保留草稿。只读或不可用设置不能保存或重置。

移动设备 SDK 与设备列表读取各自具有加载、失败和重试状态，离开视图时取消。Host SDK 检查读取已保存路径，执行只读 `adb version` 探测；未保存的编辑不影响检查。已保存但缺失或离线的设备保持选中，直到用户更改。`mobile_observe` 仅在未指定显式设备时使用已保存默认值；默认设备不可用时失败，不回退到其他设备。设备修改仍要求精确设备和观察令牌。开启自动检查不授予动作权限，手动检查不保存偏好，也不安装工具。

显式浏览器连接、主页/搜索、历史/网络检查、Cookie 文件导入和文件传输使用 browser Remote。挂载页面或保存偏好不会启动浏览器。Cookie 不显示值；下载使用 inert Blob，离开所属视图时释放 URL。文件传输保留在详情面板中，已选择页面时搜索导航会展开该面板。

安全范围编辑保留首次编辑修订号，Host 拒绝后不显示保存成功。高级出口和凭证条目支持添加、编辑及移除；空列表清除对应授权。凭证引用是环境变量名称，不是秘密值；保存不解析凭证，也不连接目的地。报告生成需要显式活动 Session id 与格式；经过授权的 Remote 返回有界字节，供 inert Blob 下载。切换 Session 或格式、重试或离开时释放旧链接。

原生风格标题和设置行继承设置壳层的宽度。搜索仅索引本地化公共标题、说明与关键词，不包含偏好值、设备标识、范围内容、凭证或报告。描述符与页面 slot 共享声明生命周期。不可用状态仍保留可识别的搜索目标；搜索目标为组件诊断时展开详情，不发起新的操作动作。

-----

<a id="dev-note"></a>
## 开发笔记

[包测试](tests/) 覆盖元数据生命周期和本地化、偏好修订号约束与重置、草稿拒绝、就绪失败、剪贴板反馈、浏览器操作，以及安全范围/报告行为。不发布运行时 invariant companion：本包读取 Host 权威结果，仅保留 UI 草稿与视图状态。协议语义归 [Device control](../../../docs/subsystems/device-control.zh.md) 所有。

-----

<a id="model-experience"></a>
## 模型体验

无，因为查看或保存设置不会增加模型内容或 token，且本包不注册提示词、工具或 Session 事件；只有用户粘贴并发送时，可复制提示词才会进入模型。

#### KV Cache 影响

无；偏好与就绪读取不会进入模型请求前缀。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- 插件加载不证明就绪，Provider 探测成功也不授予操作权限。device-control profile 使用外部 CLI 适配器，原生 Browser 不依赖它们。
- SDK 路径仅配置 Host 探测，不配置外部 Cinlan 设备运行时。SDK 检查成功不证明设备会话能够启动。
- 捕获内容、浏览器缩放和计算机控制偏好需要各自的运行 owner；本包不添加仅供预览的字段。
- 安全状态报告配置事实，不证明扫描器就绪或外部工具的策略覆盖完整。
