---
description: "定义由 Web 与 Desktop 载体共享的集成侧边栏终端连接。"
kind: "package-reference"
---

# @deepseek-ai/dsh-sidebar-terminals

[English](README.md) | 中文

## 概述

本包定义集成侧边栏终端服务与浏览器安全的请求类型。[侧边栏提供方](../../client/ui-better-sidebar/README.zh.md)使用现有的界面 PTY 管理器与代理终端注册表；[Remote 控制器](../../api/sidebar-terminal-controller/README.zh.md)通过共享 Web 和 Desktop 载体公开经过认证的操作。

## 目录

- [所有权与生命周期](#ownership-and-lifetime)
- [悬浮窗口](#floating-windows)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="ownership-and-lifetime"></a>
## 所有权与生命周期

界面终端保留会话与标签身份。代理终端保留现有注册表 UUID。连接 id 指向某一进程代次的一次连接；过期的输入、尺寸调整与关闭请求无法操作替代进程。额外的进程 id 在连接重建期间保持稳定。只读 `inspectUi` 查询已有界面进程，不创建进程或延长其生命周期；`closeUi` 在终止前比较该 id，因此持久化标签无需重新打开视图即可关闭。能力检查不创建进程。流依次发布初始信息、需要确认的输出帧和进程退出。确认输出表示 xterm 已完成消费该帧。提供方限制完整序列化帧与缓冲输出的大小，拥有原生暂停与恢复操作，并在连接结束时释放自身的暂停与监听器。

`shells` 列出本地主机已安装的可执行文件，不创建进程。界面目标的可选 `shellPath` 为新进程选择其中一个可执行文件；省略时使用提供方的设置默认值。即使发现结果或设置发生变化，已有进程在重连时仍保留自身的 Shell。代理终端目标不能选择 Shell。

视图可在会话隐藏时停泊界面终端、断开并使用配置的重连宽限期，或明确关闭其进程。新建终端尚未被确认前取消连接，会释放该进程。主机卸载请求原生进程终止并等待退出，包括没有视图连接的进程。无法确认原生退出时，提供方报告关闭超时。主机重启不会恢复进程或命令。

<a id="floating-windows"></a>
## 悬浮窗口

悬浮功能同步提供已验证的窗口 id，并将已接受的目录偏好与加载中、不可用状态区分开。新建悬浮界面标签仅捕获一次就绪目录。其 id 和存储布局包含窗口 UUID；主窗口标签存储与代理终端身份保持不变。主机仅接受已存在且等于所属会话工作区或规范化后位于其中的目录。路径穿越、符号链接逃逸与非目录目标均在创建进程前失败。主窗口和代理终端保留其会话目录策略。

<a id="model-experience"></a>
## 模型体验

无，因为本包不增加工具、消息或模型上下文。

#### KV Cache 影响

无；终端连接、偏好和可用性查询不进入模型请求前缀。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

本服务依赖具备可用原生 PTY 依赖的提供方。

- 为重连保留的输出有界；载体可用不能证明用户配置的 Shell 能够启动。
- 渲染器停止确认输出时，可能暂停 PTY，直到其连接超时。
- 核心执行终端属于独立能力。

不发布运行时不变量伴随插件，因为本包只拥有声明与抽象服务，没有独立存储的观测。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

当前原生 loader 验收证据与剩余验证记录在[验收状态](../../../.agents/plans/settings-native-acceptance-status.md)。

</details>
