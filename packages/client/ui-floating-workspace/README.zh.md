---
description: "打开独立的侧边聊天页签或小型应用内辅助会话面板。"
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

设置页通过设置图标插槽注册分栏导航图标。

<a id="use-this-package"></a>
## 使用此包

打开设置 → 个人 → 浮动工作区并启用功能。启用只增加入口，不会打开任何界面。会话头部入口会在右侧栏新建一个独立的“侧边聊天”页签。每个页签拥有自己的辅助会话；页签栏可切换、新建或关闭聊天。浮动按钮和已注册的快捷键仍只开关独立的小型悬浮面板。关闭功能会关闭该面板。偏好通过常规的带版本设置写入器保存在 Host 的 `ui-floating-workspace` 命名空间中，也就是这一行的加载器行 id。

| 偏好 | 默认值 | 生效方式 |
| --- | --- | --- |
| 启用浮动工作区 | 关闭 | 显示入口并启用命令；禁用时关闭面板。 |
| 入口位置 | 会话头部 | 会话头部新建侧边聊天页签；浮动按钮开关小型悬浮面板。 |
| 面板宽度 | 400 像素 | 悬浮面板宽度，200–800 之间的整数像素。 |
| 面板高度 | 560 像素 | 悬浮面板高度，280–800 之间的整数像素；超出视口时按视口高度和边距收缩，窄屏边距为 12 像素。 |

设置页使用一张卡片展示启用状态和入口位置；这些界面都不启动终端，因此卡片里没有目录行。侧边聊天页签和悬浮面板使用彼此独立的辅助 Session。若主会话已选中，辅助会话沿用其工作目录，但不会替换或跟随主会话选择。创建失败会显示并允许重试。默认命令为 Ctrl + Shift + Space，键盘快捷键页负责覆盖值与冲突提示。面板宽高受视口限制。

两种形态渲染的是同一个会话正文内嵌实例：`conversation.content` Component Factory 以 `variant: 'embedded'` 渲染，`views` 固定为 chat。悬浮面板注册在 frame overlay 中，并在生命周期内保留一个辅助 SessionReference。侧边聊天注册为支持多实例的右侧栏页型；每个页签创建并保留自己的辅助 Session，页签关闭或卸载时释放引用。所有入口都不会跟随或替换主会话。

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

[聊天内嵌实例](src/client/FloatingChat.tsx) 用 `renderFactorySlot('conversation.content', …)` 渲染，`variant` 为 `embedded`，`views` 只保留 chat。[悬浮面板](src/client/FloatingPanel.tsx) 注册在 frame overlay 中，并按已接受的宽度与高度偏好设定自身尺寸；[侧边聊天页签](src/client/FloatingTab.tsx) 创建独立辅助 Session 后渲染同一个内嵌实例。

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

- Host 目录会保留已关闭的辅助 Session，直到常规会话删除流程清理；右侧栏页签布局仍遵循按主会话保存的现有规则。本包不提供终端实现、自动窗口恢复或独立应用外壳。

<a id="dev-note"></a>
### 开发说明

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
