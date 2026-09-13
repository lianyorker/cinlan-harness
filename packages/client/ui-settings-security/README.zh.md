---
description: "在 Settings 中检查桌面与手机模拟器 Provider 就绪状态，查看浏览器设置和设计能力说明。仅当 Host 预设名单包含 security-research 时显示安全研究。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-security

[English](README.md) | 中文

## 概述

在 Settings 中检查桌面与手机模拟器 Provider 就绪状态，查看浏览器设置和设计能力说明。仅当 Host 预设名单包含 security-research 时显示安全研究。

## 目录

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

与 Settings、Locale、pluginInventory、deviceCapabilities 和 agentPresets Remote 一起挂载。Computer Use 卡片复制 `dsh --profile device-control`；此命令启动独立 profile，不会安装外部软件。三个使用卡片说明观察、输入和操作后验证。

安全研究导航在挂载、窗口获得焦点、设置更新与重连时读取权威预设名单。失败或过期读取不能新增分区。通用 Skills 和本 Settings 插件不是安装证据。页面及导航图标均由可释放的 Slot 贡献提供。

浏览器与手机模拟器采用有序设置卡片。SDK 配置和默认设备持久化尚不可用；Browser 通过原生 Remote 提供显式 Cookie 文件导入与上传下载操作。Design Studio 的安装与替换方案尚未确定；本页不覆盖设计工具，也不声称存在可用安装器。[设计参考](DESIGN.md)负责布局与状态展示。

安全研究通过专属 securityResearch/describe Remote 读取预设可用性、范围有效性和实际内置技能数量。技能发现不完整或预设损坏时保持需要检查状态。这些是配置事实，不表示扫描器就绪或所有动作已受授权约束。设备页面将现有 CLI 适配器明确列为尚未完成的原生迁移，不再引导到其他应用配置。

浏览器设置通过共享 Settings 镜像绑定 browser-playwright 命名空间。草稿保留读取修订号，写入通过一次原子修改完成，失败保留草稿。保存不会启动浏览器或授予权限；重启后应用保存的偏好。显式连接、主页/搜索、记录检查和文件操作由 browser Remote 执行；挂载页面或保存偏好不启动浏览器。Cookie 不显示值；下载以 inert Blob 保存，离开面板时释放 URL。

安全范围草稿通过框架绑定的 Settings selector 读取，保留首次编辑修订号；Host 拒绝后不显示保存成功。表单编辑授权身份、有效期、目标、主机、操作、排除项和证据策略，并保留高级网络出口与凭证引用；后两者仍可在插件配置中编辑。生成报告需要显式活动 Session id 与格式；经过授权的 Remote 返回有界字节，供 inert Blob 下载。切换格式或 Session、重试或离开面板时释放旧链接。

<a id="model-experience"></a>
## 模型体验

无。设置展示不注册 prompt、tool 或 Session event。

#### KV Cache effect

无；这些读取不改变模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 插件加载不证明 Provider 就绪；Provider 探测成功也不代表动作授权。历史 device-control profile 仍使用外部 CLI 适配器，并在设备操作前请求审批；原生 Browser 不依赖它们。剪贴板写入被拒绝时会显示失败，不会谎报复制成功。

不发布 runtime invariant companion：页面只保留组件本地状态，权威状态由 Host 返回。

### 开发备注

协议和状态语义见 [Device control](../../../docs/subsystems/device-control.zh.md)。
