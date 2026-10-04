---
kind: upgrade-guide
description: "浏览器、计算机控制与安全研究无需设置页即可直接使用。"
---

# 能力设置页移除

[English](guide.md) | 中文

## 变更

设置导航只保留一个能力页面：手机模拟器。安全研究、浏览器与计算机控制不再有设置页，因为它们的服务提供者现在随 Web 产品组合默认启用。

Web profile 挂载 @deepseek-ai/dsh-cinlan-browser 与 @deepseek-ai/dsh-cinlan-computer-use，并且 @deepseek-ai/dsh-web-capability-defaults 把 browser-playwright 与 computer-use-cua-driver-native 从停用改为启用。审批策略不变：浏览器的观察、导航与交互仍然询问，原生计算机控制仍然询问。

内置的 security-research Agent 预设随 security-research bundle 挂载即进入预设名单，不依赖已安装的技能资源，并在内置分组中紧跟 PTC 模式之后。

客户端包 @deepseek-ai/dsh-client-ui-settings-security 现在只渲染手机模拟器页面：探测设备提供者、编辑 SDK 路径与默认设备、列出移动工具，并管理 Android 运行资源。

## 迁移

1. 重启一次 Web profile，使组合变更生效。
2. 现有 profile 需要在 bundle 列表中加入 @deepseek-ai/dsh-cinlan-computer-use 才能获得原生桌面提供者；新 profile 的模板已包含它。
3. 浏览器偏好改为从 profile 补丁中的 browser-playwright Config 行读取，不再有浏览器页面。
4. 安全研究工作改为在 Agent 预设中选择「安全研究」；安装技能资源只会扩展它的技能目录。
5. 需要关闭某项能力的部署，用插件管理器停用对应提供者。
