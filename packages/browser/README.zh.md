---
description: "Cinlan Harness 持久化 Browser 能力族。"
kind: "package-group"
---

# browser/ - 持久浏览器能力家族

[English](README.md) | 中文

## 概述

通过可选 provider 和面向模型的 Consumer 控制持久 Browser 页面与经过校验的元素截图。

## 目录

- [包](#packages)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

这个可选家族控制 Cinlan IDE 暴露的持久网页，不在 harness 中嵌入浏览器引擎。能力参考位于 [`browser/`](browser/README.zh.md)。

| 包 | 角色 | 运行时贡献 |
|---|---|---|
| [`browser/`](browser/README.zh.md) | Service Definition | `ctx.browser` provider 注册表与执行入口 |
| [`browser-cinlan/`](browser-cinlan/README.zh.md) | Service Provider | 通过 `ctx.subprocess` 调用公开的 `cinlan ... --json` 浏览器命令 |
| [`browser-playwright/`](browser-playwright/README.zh.md) | 可选 Service Provider | Playwright 持久页面与经过校验的元素截图 |
| [`tool-browser/`](tool-browser/README.zh.md) | 面向模型的 Consumer | 七个 `browser_*` 工具与持久浏览器指引 |
| [`tool-browser-element-capture/`](tool-browser-element-capture/README.zh.md) | 可选的面向模型 Consumer | 人工元素选择与经过校验的 crop 工具 |
| [`browser-permission-policy/`](browser-permission-policy/README.zh.md) | 权限策略 Consumer | 相互独立的观察、导航和交互决策 |

持久 Browser 通过 page id 和短期有效的无障碍观察操作 Cinlan 管理的网页。OS Computer Use 操作桌面窗口、原生应用和操作系统控件；它是独立能力，本家族不实现该能力。

默认 Cinlan Web 组合使用 `browser-cinlan`，并挂载 element-capture Consumer 和 executor，不挂载 Playwright Provider。Playwright、Electron、Tauri、远程配对、下载、trace 和 desktop shell 能力仍由独立的可选包提供。

<a id="dev-note"></a>
## 开发备注

该包组没有独立的 subsystem 页面；持久 Browser 文档由组 README 与包 README 负责。
