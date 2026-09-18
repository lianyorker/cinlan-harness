---
description: "注册真实键盘操作，为本地编辑器与主界面处理器解析已保存的快捷键。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-keyboard

[English](README.md) | 中文

## 概述

本包把已注册操作与现有 `keybindings` 偏好连接起来。操作所有者提供稳定的命令 id、焦点作用域、本地化名称、默认绑定和可选的实时可用状态。本地事件处理器在按键到达时读取当前绑定。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

将这个普通的 Host/Client 插件与设置、语言服务一同挂载。Host 入口注册持久化命名空间，Client 入口提供 `ctx.keyboard`。[快捷键设置](../ui-keybindings/README.zh.md) 展示当前组合中各操作所有者提供的命令。

所有者扩展 `@deepseek-ai/dsh-client-keyboard/client` 的 `KeyboardCommandMap`，声明各命令 id 与作用域。在 Cordis effect 中注册默认绑定并返回注册的 disposer。名称和说明使用函数，使语言变化能重新发布当前文案。可选的可用状态源在所属能力不可用时禁用该操作。

所有者在现有焦点处理器中把普通 `KeyEventFacts` 传给 `matches(id, facts)`。该服务不持有 document 按键监听器。Lexical、CodeMirror 与主界面继续负责自己的焦点、弹层和操作仲裁；组件通过回调与渲染器绑定的可观察源获取能力。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

已保存的 `overrides` 数组保留现有命令 id、按键、修饰键标志以及可为 null 的绑定。null 绑定禁用该操作。可移植的 `mod` 在 Apple 平台解析为 Meta，在其他平台解析为 Ctrl。显式覆盖会替换该命令的全部默认别名。没有已注册操作的记录保持不可用，并在编辑其他绑定时保留。

[控制器](src/client/controller.ts) 在变化之间维持快照引用稳定，检测同一作用域内生效默认值与覆盖项的冲突，并拒绝保留或无效组合。已被处理的事件、输入法组字、229 键码、AltGraph 以及未获所有者允许的重复按键都不会触发操作。输入框原生 Shift+Enter 保留给 Lexical。各所有者仍负责判断自己的本地操作能否执行。

写入依次执行。变更写入只有在观察到更新的已接受 revision、预期原始用户覆盖与匹配的生效值后才成功。已有的相同覆盖无需写入。重置最后一行或全部快捷键会 unset `overrides` 叶子，让继承设置重新解析。逐行重置从用户数组移除该命令；配置中的基础覆盖遵循设置所有者的数组替换语义。

释放注册会移除命令及其可用状态订阅。释放插件会解除设置与语言订阅。本包不发布运行时 invariant 伴随入口：生效命令数据直接派生于设置源和当前注册，注册与分发的前置条件由所属操作执行检查。

</details>

-----

<a id="model-experience"></a>
## 模型体验

无，因为键盘偏好记录不进入模型请求或 Session 日志，被调用的操作保留其所属功能的行为。

#### KV Cache 影响

无。绑定解析不增加模型输入或 token。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

只有已注册操作可以改键。编辑器原生手势与不可用的旧操作保留各自的所有权。浏览器和操作系统保留组合会被拒绝；当前界面记录单个逻辑按键组合，不支持多步组合或物理键位绑定。
