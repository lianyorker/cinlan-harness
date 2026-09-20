# Agent Note: 并行子代理对话标签页

Status: implemented

[English](2026-09-19-parallel-subagent-conversation-tabs.md) | 中文

## Problem

通过主会话选择打开目录中的子代理，会让父会话离开主对话区。better-sidebar 现有的 Side Chat 创建独立线程，并拥有另一套记录展示，因此不能为已寻址的子代理提供包含普通工具卡片和编辑器的并行视图。

## Decision

目录提供显式的**在侧边栏打开**操作，拓扑子节点调用新增的 `betterSidebar.openSubagentChat(address, scope?)` 方法。每个隐藏的 `subagentchat` 标签页将直接父级地址保存在资源 URL 中，复用现有标签去重与分栏位置。这是真正的并行子代理视图：打开标签页绝不会在主对话区选中子代理。普通目录行仍选择主区域子代理视图，父级面包屑保持原导航行为。

`sessions.retainSubagent` 验证目录地址、配置标准子代理传输，并独立于当前选择保留特定身份的 Session scope。多个引用共用该 scope。释放或中止一个引用不能销毁其他引用或已选中的 Session；已销毁 scope 的迟到任务不能修改替代实例。

现有 Conversation 注册启用 `reusable: true`。renderer 的 `renderSessionView` 操作针对显式保留的 Session 解析标准 hook、store、注入回调与子插槽。复用保留原插槽授权，并在每个实例内隔离错误。重载在渲染替代注册前重新验证授权。可选嵌入式展示隐藏主导航与宽度拖柄；记录组装、工具卡片、输入和交互接管均使用普通 Conversation 树与传输。

[Web 目录与人工继续交互决策](2026-07-27-web-subagent-conversations.zh.md) 继续定义直接父级权限、只读一次性记录、在线父级继续交互与独立 Stop。该决策保持活跃；并行位置不会取代其授权规则。本变更不增加包或传输。

## Alternatives considered

**切换主 Session 后重新打开拓扑。** 这仍然一次只保留一个对话，不能满足同时阅读父子对话的要求。

**复用 SideChatView 的记录构造。** 其线程生命周期与轮询展示独立于标准 Conversation 渲染器；扩展它会重复工具渲染与输入规则。

**迁移完整的可复用 Factory 与资源框架。** 显式复用选择启用的 Session 注册条目即可提供所需实例，减少 API 变化并保留本地 better-sidebar 服务和分栏实现。

## Consequences

保留的标签页在卸载前持有一个引用，即使其他标签页处于活动状态也如此。恢复的标签页先加载目录，再保留子代理。关闭视图不会取消子代理 Agent。嵌入式 Conversation 使用现有主题 token 与侧栏布局。即使另一个 Session 被选中，功能插件仍收到针对子代理的 projection 与命令。

聚焦的无密钥测试覆盖独立引用、迟到打开与销毁、子代理 scope 的 hook 和 projection、复用注册重载、跨分栏标签去重、普通编辑器渲染，以及目录与拓扑两种操作。包内目录快照记录新增的侧栏打开操作。
