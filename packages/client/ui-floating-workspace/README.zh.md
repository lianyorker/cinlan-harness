---
description: "通过持久化的入口、尺寸与新终端目录偏好打开应用工作区窗口。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-floating-workspace

[English](README.md) | 中文

## 概要

浮动工作区把会话开成应用内聊天面板：悬浮在会话之上，或停靠为右侧栏页签。其设置页控制启用状态、入口位置和悬浮面板尺寸。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

打开设置 → 个人 → 浮动工作区并启用功能。启用只增加入口，不会打开任何界面。会话头部入口打开停靠的右侧栏页签，由页签自带的关闭控件收起；浮动按钮入口与已注册的快捷键开关悬浮面板。关闭功能会关闭面板。偏好通过常规的带版本设置写入器保存在 Host 的 `ui-floating-workspace` 命名空间中，也就是这一行的加载器行 id。

| 偏好 | 默认值 | 生效方式 |
| --- | --- | --- |
| 启用浮动工作区 | 关闭 | 显示入口并启用命令；禁用时关闭面板。 |
| 入口位置 | 会话头部 | 会话头部打开停靠的右侧栏页签；浮动按钮打开面板。 |
| 面板宽度 | 400 像素 | 悬浮面板宽度，200–800 之间的整数像素。 |
| 面板高度 | 300 像素 | 悬浮面板最大高度，150–600 之间的整数像素。 |

设置页使用一张卡片展示启用状态和入口位置；面板不启动终端，因此卡片里没有目录行。仅存在会话头部时才显示头部入口；快捷键也能在应用的无会话视图中使用。默认命令为 Ctrl + Shift + Space，键盘快捷键页负责覆盖值与冲突提示。面板宽度受视口限制。

两种形态渲染的是同一个会话正文内嵌实例：`conversation.content` Component Factory 以 `variant: 'embedded'` 渲染，`views` 固定为 chat。因此面板里是消息列表、工具卡片与输入框，没有主会话头。悬浮面板注册在会话会话区内的座位，由该座位提供会话绑定与 Conversation 域的上下文，并用自身 CSS 定位在会话之上；停靠形态是一个右侧栏页型，页体渲染同一个内嵌实例。打开任一种形态都不会创建会话或提交输入。

可选的 `floatingTerminalConsumer` 服务仍为真实终端消费者保留接线，但本界面不再编辑任何目录。

### 组合与配置

Host 入口通过 `Config` 注册偏好 schema，它是 `FloatingWorkspaceSettingsSchema` 的 volatile 形式，设置文档因此会发布该命名空间。Client 消费设置、语言、插槽、键盘和会话服务；设置页使用 `floating-workspace` 分区标识和 `personal` 分组。可选的 `floatingTerminalConsumer` 服务只在真实终端消费者的生命周期内允许编辑目录。共享的 `floatingWorkspaceContext` 回调发布 [侧边终端类型](../../terminal/sidebar-terminals/src/types.ts) 中的 JSON 数据；不会跨包导入 UI 实现。

| 部署配置 | 默认值 | 含义 |
| --- | --- | --- |
本包没有部署配置：面板不需要可调项，原先的窗口关闭轮询随独立应用窗口一起消失。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

[注册入口](src/client/index.ts) 拥有词典、可搜索元数据、命令、右侧栏页型，以及现有设置、头部、侧边栏和浮层插槽中的贡献。设置元数据跟随设置插槽声明的生命周期。组件接收框架绑定的可观察事实与普通回调。浮层入口把键盘匹配交给键盘服务。

[运行时](src/client/runtime.ts) 拥有面板开合状态与已接受的设置快照。写入使用规范的设置变更操作，并同时确认生效字段和原始已接受字段。写入被拒绝时保留已接受值。禁用功能与销毁会关闭面板；销毁还会移除设置订阅并等待进行中的偏好写入。

[聊天内嵌实例](src/client/FloatingChat.tsx) 用 `renderFactorySlot('conversation.content', …)` 渲染，`variant` 为 `embedded`，`views` 只保留 chat。[悬浮面板](src/client/FloatingPanel.tsx) 注册在会话会话区内，并按已接受的宽度与高度偏好设定自身尺寸；[停靠页签](src/client/FloatingTab.tsx) 为右侧栏页型渲染同一个内嵌实例。

本包不发布运行时不变量配套入口：已接受的设置与面板状态具有单一所有者。Loader 持久化测试、注册销毁测试与面板开合测试覆盖这些关系。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

以下资料负责周边设置、键盘、窗口和终端行为。

- [设置领域](../ui-settings/README.zh.md) — 带版本写入与分区元数据。
- [键盘服务](../keyboard/README.zh.md) — 已注册命令、覆盖值和事件匹配。
- [侧边终端类型](../../terminal/sidebar-terminals/src/types.ts) — 立即可用的窗口身份与创建新终端时捕获的目录数据。
- [Client 插槽](../../../docs/subsystems/slots.zh.md) — 声明、框架钩子和注册生命周期。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包不注册面向模型的提示或工具，也不写入会话事件。

#### KV 缓存影响

无；本包不会组装或发送提供商请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 运行环境控制弹出窗口可用性和最终窗口尺寸。缺少所需 UUID 能力的浏览器会显示功能不可用。无会话视图没有会话头部插槽位置。缺少真实终端消费者时，目录字段与选择器保持禁用；选择器失败会保留手工输入，终端 Host 会拒绝所选会话工作树以外的目录。本包不提供终端实现、自动窗口恢复或独立应用外壳。

<a id="dev-note"></a>
### 开发说明

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
