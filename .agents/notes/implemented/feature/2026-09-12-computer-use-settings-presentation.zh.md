# Agent Note: Computer Use 设置呈现迁移

Status: implemented

[English](2026-09-12-computer-use-settings-presentation.md) | 中文

## 问题

Settings 外壳此前只显示通用 Computer Use Loader inventory 页面，而产品参考图要求展示能力状态、可复制 CLI 命令，以及观察、桌面操作和验证三类简明使用指引。

## 决策

卡片布局、复制控件和使用说明保留在 ui-settings-security。状态来源和 profile 启动由[设备就绪决策](2026-09-12-device-profile-and-provider-readiness.zh.md)负责；Loader 激活不表示软件安装成功。安全研究共享图标、主卡片和使用说明卡片层级。浏览器与手机模拟器使用有序设置卡片，Loader 诊断收起在产品说明下方。

计算机观察信息来自设备就绪应答，包括平台、Provider 与协议版本以及声明的支持能力。读取缺失或失败时不复用较早的观察信息。权限保持为 `unknown`；成功读取描述信息不等于获得操作授权。页面既不探测也不更改操作系统权限。

## 备选方案

单独新增 Computer Use 设置包可以隔离功能，但会重复 capability roster 并拆分现有 Settings 集成。继续使用 `ui-settings-security` 可让注册、inventory 读取和本地化保持在同一 owner 中。

让浏览器页面直接执行安装或权限变更会产生第二个策略 owner。因此页面只呈现命令，执行仍由 Host/CLI 服务负责。

## 结果

Computer Use 页面现在沿用 Settings 视觉语言：细边框、克制的中性背景、语义主题别名、紧凑控件和响应式卡片。复制反馈局限在当前控件，并使用共享 clipboard helper。Host inventory 缺失或失败的状态保持可见，也不会隐藏安装指引。

## 验证

组件测试和真实 Web 设备就绪场景覆盖当前卡片。[就绪决策](2026-09-12-device-profile-and-provider-readiness.zh.md)负责原生设备验证的限制。

## 延期工作

手机模拟器表示 Agent 控制设备，不是手机客户端反向连接 Harness。SDK 检测和默认设备偏好由[原生设置所有者](../architecture/2026-09-17-native-settings-runtime-consumers.zh.md)负责；浏览器 Cookie 导入使用[原生 Browser 操作](2026-09-13-native-browser-operations.zh.md)。这些操作不会安装软件或授予设备权限。计算机选择和操作系统权限控件仍不可用。GitHub 发布及可下载的依赖闭包需要单独实现发布流程。
