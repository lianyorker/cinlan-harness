---
description: "通过包含分类、上下文共享说明和可重试草稿的对话框，提交消息评分与整段对话反馈。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-message-feedback

[English](README.md) | 中文

## 概述

你可以为已完成的回答或整段对话提交反馈。赞和踩按钮打开包含七种可选分类及详情输入框的对话框；单独的 `/feedback` 为 Session 打开同一表单。对话框说明提交内容包括当前对话日志。反馈不进入模型上下文，提交失败时保留草稿以便修正。

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

与 `ui-conversation` 和 `ui-commands` 一起挂载本插件。点击尚未记录的评分会打开反馈对话框；提交后记录该评分及可选分类和说明。关闭对话框会丢弃草稿，不产生记录。再次点击已记录的评分会撤回它。输入框菜单和单独的 `/feedback` 打开 Session 表单，`/feedback <text>` 则沿用宿主命令及其确认行。

### 失败

列表加载或撤回失败会显示在评分按钮旁。提交失败时显示警告提示，并保持对话框草稿打开。发生冲突时，已记录评分按宿主响应更新，草稿仍可重试。只有已定稿的消息显示反馈控件。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

每个 Session 共用一个消息控制器和一个对话框控制器。消息控制器将首次读取延迟到交互时，串行处理变更，并使用宿主版本进行比较并交换更新。对话框将消息评分交给 `messageFeedback`，将 Session 备注交给 `sessionFeedback`。较晚完成的成功提交会确认已保存反馈，但不会关闭新草稿；销毁后不再通知。槽位条目与无参数命令装饰共享插件生命周期。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当反馈面不够用时阅读以下页面。它们从浏览器条带进入 Session 日志后端与会话外壳。

- [dsh-message-feedback](../../feedback/message-feedback/README.zh.md)——拥有按条目比较并交换与持久化的 Session 日志后端。
- [ui-conversation](../ui-conversation/README.zh.md)——声明助手动作条并渲染动作行。
- [客户端包映射](../README.zh.md)——相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

无。评分与备注是仅写日志的事件，不是模型输入。可选的 Session 日志投递使用请求元数据，而非模型上下文。

#### KV Cache 影响

无；反馈变更不改变模型可见的历史。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前反馈表面。它们是当前包约束，不是通用评分对比或任务积压。

- **备注大小是宿主策略**——部署方配置 `maxNoteBytes`（Web bundle 中为 8192），超长备注由宿主以 `note-too-large` 拒绝。对话框不预先校验该上限，因此消息说明超长时在提交阶段失败，并保留草稿。Session 备注没有大小限制。
- **无跨标签页推送**——另一个标签页的评分要等到重连或下一次冲突响应才可见，不会立即出现；控制器不消费反馈日志事件。
- **仅限对话视图**——trajectory 与 waterfall 视图不渲染反馈控件，尽管它们的助手节点也带有相同的 `messageId`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。槽位注册、命令装饰与逐 Session 控制器共享插件生命周期；生命周期测试观察它们的移除，并验证销毁后不会发布。
