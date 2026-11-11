# Agent Note: 工作树任务的父子链接放在 fork 自有 domain，不改官方 WorkspaceRecord

Status: implemented

[English](2026-10-31-worktree-task-parent-links-in-fork-domain.md) | 中文

> 范围：Worktree Task checkout 工作区与其源工作区之间的父子关系存在哪里、如何对外提供，以及为什么官方 `WorkspaceRecord` schema 保持不动。实施计划见 docs/dev/工作树会话归属/plan.zh.md。

## Problem

Worktree Task 会创建一个 checkout 工作区，逻辑上它是被分支的源工作区的子级。侧边栏需要渲染这种嵌套，客户端也需要一种持久、重启安全的方式来知道哪个工作区是 task checkout、哪个是它的父级。看起来最直接的修法是给官方 `WorkspaceRecord` 加 parent/kind 字段，并让官方 `WorkspaceRegistry` 理解层级——但这个 schema 属于上游，fork 规则禁止在官方包里散落 Cinlan 业务逻辑。

## Decision

父子关系从头到尾由 fork 自有：

- 桥接包 `packages/workspace/worktree-task-workspace` 把每条链接持久化在自己的 storage domain `worktree_task_workspaces`（version 1，表 `links`，以 checkout 工作区 id 为 key，携带 `taskId`、可选 `parentWorkspaceId` 和 `createdAt`）。官方 `WorkspaceRecord` 不加任何字段，`packages/workspace/workspace` 不做修改——包括 `src/entity.ts` 里 `attachSession` 的 cwd 校验，与上游保持完全一致。
- 桥接包响应 `worktree-task/changed` 事件：注册 checkout 工作区、按源路径解析父级、补账会话头 cwd 等于 checkout 路径的会话，并发出 `worktree-task-workspaces/changed`。
- API 层通过 `WorktreeTaskController.followWorkspaceLinks`（`@Remote({ mode: 'stream' })`，baseline + changed 帧，每次都是完整集合）投影链接，并在 liveshare 中归类为 owner-only。stream 同时监听链接变化和已提交的 task 转换，因为 task 状态可以变化而 Workspace 链接保持不变。
- 客户端在 `ui-worktree-task` 消费该 stream，把父级映射喂给官方 `uiWorkspace.registerParentHints` 扩展点，并通过 `sidebar.workspaces.group.trailing` slot 渲染任务徽标。官方 ui-workspace 的改动只是通用扩展点（见 plan 2.7）。

卸载桥接插件可干净退化：task 工作区退化为普通顶层工作区，links 表成为无害的孤立数据；官方 schema 从未被改过。

## Alternatives considered

- **给官方 `WorkspaceRecord` 加 parent/kind 字段，并让 `WorkspaceRegistry` 理解层级。** 否决：这会改动上游拥有的持久 schema，并把 Cinlan 的工作区树逻辑散进官方包，违反 fork 边界规则；每次上游同步都要为一个上游不想要的 schema 承担合并风险。
- **新建 `workspace-hierarchy` 客户端包，在渲染时按路径推导父子。** 被否决，采用 B'：按路径推导的嵌套是隐式的，checkout 移动或工作区重新注册时就会失效；显式链接记录在重启和目录移动后依然成立，而且官方 ui-workspace 已经获得了通用的 `registerParentHints` 接缝，不需要第二个竞争的层级来源。
- **让 `bindSession` 顺带调用 `attachSession`。** 否决：bind 时子会话头还不存在（agent-team 先 bind 后建会话），attach 会失败；attach 发生在会话已创建且 cwd 已确定为 checkout 之后。

## Consequences

- 关系持久且重启安全，子会话的 cwd 持久化在会话头里（agent-team 把 `createdTask.checkoutPath` 作为激活 `cwd` 传入），因此归属可以仅凭 session log 重建。
- 代价：父级信息可能同时存在两个来源——links 表的显式提示和官方按路径推导的分组。官方合并策略（显式提示优先、快照身份稳定）保证了确定性；桥接包会过滤用户已删除工作区的链接。
- fork 多拥有一个 storage domain；上游 schema 迁移永远不会与它交互。
