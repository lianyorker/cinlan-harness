# Agent Note: Computer Use 设置呈现迁移

Status: implemented

[English](2026-09-12-computer-use-settings-presentation.md) | 中文

## 问题

Settings 外壳此前只显示通用 Computer Use Loader inventory 页面，而产品参考图要求展示能力状态、可复制 CLI 命令，以及观察、桌面操作和验证三类简明使用指引。

## 决策

卡片布局、复制控件和使用说明保留在 ui-settings-security。状态来源和 profile 启动由[设备就绪决策](2026-09-12-device-profile-and-provider-readiness.zh.md)负责；Loader 激活不表示软件安装成功。安全研究与设计共享图标、主卡片和使用说明卡片层级。浏览器与手机模拟器使用有序设置卡片，Loader 诊断收起在产品说明下方。

## 备选方案

单独新增 Computer Use 设置包可以隔离功能，但会重复 capability roster 并拆分现有 Settings 集成。继续使用 `ui-settings-security` 可让注册、inventory 读取和本地化保持在同一 owner 中。

让浏览器页面直接执行安装或权限变更会产生第二个策略 owner。因此页面只呈现命令，执行仍由 Host/CLI 服务负责。

## 结果

Computer Use 页面现在沿用 Settings 视觉语言：细边框、克制的中性背景、语义主题别名、紧凑控件和响应式卡片。复制反馈局限在当前控件，并使用共享 clipboard helper。Host inventory 缺失或失败时，安装指引仍然可见。

## 验证

组件测试和真实 Web 设备就绪场景覆盖当前卡片。[就绪决策](2026-09-12-device-profile-and-provider-readiness.zh.md)负责原生设备验证的限制。

## 延期工作

手机模拟器表示 Agent 控制设备，不是手机客户端反向连接 Harness。此集成没有 SDK 检测、默认设备持久化与 Cookie 导入的 Host API，因此页面显示说明，而非模拟开关或安装按钮。Design Studio 的独立安装与替换仍待决定；已安装的设计 Skill 是方法指引，不证明 Design Studio Provider 存在。GitHub 发布及可下载的依赖闭包需要单独实现发布流程。
