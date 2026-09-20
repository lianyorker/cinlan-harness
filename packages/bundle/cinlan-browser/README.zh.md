---
description: "可选的 Cinlan 持久化 Browser profile 组合包。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-cinlan-browser`

[English](README.md) | 中文

## 概述

本组合包以可选 profile 层装配持久化 Browser service、Harness 自有 Playwright provider、审批策略和面向模型的 tools。

## 目录

- 概述
- 模型体验
- 已知限制与后续工作
- 开发备注

`@deepseek-ai/dsh-cinlan-browser` 是通过本地原生提供方提供持久浏览器访问能力的可选 profile 补丁组合包。请将它添加在 [`@deepseek-ai/dsh-base`](../base/README.zh.md) 之后；它不会进入 base 组合包，也不会进入任何未显式列出它的 profile。

[`cordis.patch.yml`](cordis.patch.yml) 挂载 [@deepseek-ai/dsh-browser](../../browser/browser/README.zh.md)，选择 local 提供方，挂载 [@deepseek-ai/dsh-browser-playwright](../../browser/browser-playwright/README.zh.md)、[@deepseek-ai/dsh-browser-permission-policy](../../browser/browser-permission-policy/README.zh.md) 和 [@deepseek-ai/dsh-tool-browser](../../browser/tool-browser/README.zh.md)。提供方直接启动系统 Chrome、Edge 或固定版本托管 Chromium，使用 Harness 独立浏览器 profile。同包 `browser-runtime` 行提供只读检测及显式组件安装、修复、取消与移除；不需要 Orca 进程、服务、登录或配置。

本组合包默认对观察、导航和交互全部请求审批。后续 profile patch 可以替换完整 browser-permission-policy 配置。可执行路径、浏览器通道和存储目录覆盖属于 browser-playwright 行；行配置整体替换，缺省字段使用提供方默认值。

此 bundle 还挂载 [Browser Remote](../../api/browser-controller/README.zh.md)，供经过认证的人工设置操作，并挂载[元素捕获页](../../client/ui-browser-element-capture/README.zh.md)，在 Web 设置中选择、预览图片并附加到 Session 草稿。Profile 决定何时挂载本 bundle；运行时管理器独立于 Provider 启用状态。模型审批策略仍覆盖新增导航、检查与传输工具，人工 Remote 不以模型工具调用运行。

## 模型体验

### 持久浏览器工具

#### 模型看到的内容

组合包启用后，模型会收到 `browser_list`、`browser_open`、`browser_navigate`、`browser_snapshot`、`browser_click`、`browser_screenshot`、`browser_close`，以及原生主页/搜索、历史/网络和文件传输 schema，还有由 [`@deepseek-ai/dsh-tool-browser`](../../browser/tool-browser/README.zh.md) 持有的稳定持久浏览器指引。尚未获批的调用会返回 permission-policy 包持有的对应类别 approval 文本。

#### Token 影响

工具 schema 与浏览器指引会向请求前缀添加固定内容。工具结果随操作而变化；截图通过已组合的 attachment 服务保留图片字节，而不会把编码字节嵌入文本。

#### KV Cache 影响

对于固定的组合包与子包配置，请求前缀保持稳定。添加或移除该组合包，或修改会改变 schema 或提示词的工具配置，会使请求前缀从对应位置起无法复用。

## 已知限制与暂缓事项

- **需要 base 服务**：该组合包要求 profile 提供 settings、subprocess、attachment、system-prompt、tool 与 approval 服务，通常由 `dsh-base` 提供。
- **默认每项操作都需询问**：没有 approval answerer 的 surface 会拒绝浏览器调用，直到其 profile 提供另一套显式策略。
- **显式安装浏览器** - 系统通道必须已存在；Settings 可通过运行时服务安装固定版本托管 Chromium 组件。插件启用不触发下载；Settings 启动偏好在 profile 重启后应用。
- **浏览器能力不等于 Computer Use**：该组合不会控制桌面窗口、原生应用或操作系统输入。


<a id="开发备注"></a>
### 开发备注

组合包只负责 composition；Browser transport 与 tool contract 保留在各自专用包中。

本包不发布运行时 invariant 配套入口，因为此 bundle 仅声明静态插件组合，不保留独立运行状态。
