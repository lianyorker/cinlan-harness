---
description: "在既有 Settings Plugins 页签中管理 Web profile 插件，支持安装诊断、显式脚本批准与移除确认。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-plugin-manager

[English](README.md) | 中文

## 概述

在 Settings → Plugins → Management 中查看已安装 bundle、启用或禁用插件，以及安装或移除 bundle。安装过程显示 Host 诊断，并在依赖脚本受阻时请求显式批准。移除需要确认，且仅向 Host 标记为可移除的包提供操作。Web 包操作影响当前 profile。Desktop 支持实时切换插件行的启用状态；「添加插件」打开原生插件窗口以修改包。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Web bundle 在既有 Plugins 设置分区中自动挂载本插件。自定义组合将其作为 Cordis 插件，与 Settings 外壳、locale 服务、Remote 客户端及 Host 插件管理器一起挂载。本插件没有配置字段。

### 管理 profile

打开 Management 以加载当前 profile 清单。启用与安装结果区分已应用变更、重启要求、更高优先级覆盖和失败。安装必须返回包标识，UI 才会报告成功。配置表单仍由其功能属主贡献。Desktop 插件行切换产生已应用的变更后，会在清单读取完成时刷新渲染器，保留当前 URL，Host 保持运行。

Web 安装对话框检查请求的包、显示流式诊断，并允许在安装运行期间取消。若依赖脚本需要许可，请检查列出的包名并显式批准重试。卸载在发送请求前打开独立确认框；受保护的包没有卸载操作。

### 可用性与失败

缺少受管理 profile 的 Remote 服务时，页签显示不可用状态，Settings 仍可使用。Desktop 仅在 `dsh-app://app` 使用 `dshDesktop.openPlugins()`；缺少打开窗口的能力时，「添加插件」显示本地化指引，提示从应用菜单打开「桌面插件」。Host 拒绝 Desktop 包检查、安装、移除与 bundle 选择。传输失败与 Host 拒绝显示为错误；未经确认的取消不会显示为成功。重试前请查看 Host 诊断。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

客户端激活时只要求 slots 与 locale，并在 Remote 可用时通过 `ctx.inject` 绑定事件。它以 id `management`、顺序 `20` 注册 `settings.plugins.tab`；Settings 外壳继续负责页面布局与导航。控制器按需加载，并在 Host 变更或连接重置后刷新观测到的清单。

功能插件贡献 `plugins.item`、`plugins.bundle.config` 和 `plugins.row.config` slot。本包渲染这些贡献，并把修改委托给 [Host 管理器](../../boot/plugin-manager/README.zh.md)；它不拥有 profile 文件或包事务。

| 源码 | 职责 |
|---|---|
| [index.ts](src/client/index.ts) | Settings 注册与可选 Remote 生命周期 |
| [manager-store.ts](src/client/manager-store.ts) | 清单、请求、安装进度与结果 |
| [InstallDialog.tsx](src/client/InstallDialog.tsx) | 诊断、取消与显式脚本批准 |
| [slot-contract.ts](src/client/slot-contract.ts) | 功能拥有的配置贡献 |

**运行时不变式：** 不发布伴生入口。UI 状态投影 Host 结果，注册是由 slot 注册表拥有的 effect；没有独立的持久状态需要协调。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [插件管理器](../../boot/plugin-manager/README.zh.md)——profile 所有权与包操作。
- [插件设置](../ui-settings-plugins/README.zh.md)——外层 Plugins 设置分区。
- [Settings](../ui-settings/README.zh.md)——功能表单的持久化与导航。

-----

<a id="model-experience"></a>
## 模型体验

间接影响模型体验：受管理插件自身的工具与提示词贡献会进入后续模型请求。

#### KV Cache 影响

UI 不添加模型请求内容。改变插件启用状态可能改变后续工具声明或提示词贡献及其缓存复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

可用操作遵循 Host 的 profile 策略：

- Desktop 包修改使用原生外壳的事务路径。
- 变更作用于整个 profile；agent（智能体）预设保持只读。
- 部分变更需要重启 Host，更高优先级的 patch 可能覆盖 profile 编辑。
- 取消或失败的安装可能保留已下载文件与诊断日志；恢复保证由 Host 拥有。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
