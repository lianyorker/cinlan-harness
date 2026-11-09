---
description: "把 Worktree Task checkout 桥接进 Workspace 注册表，附带持久化父级链接和一次性会话补账。"
kind: "package-reference"
---
# @cinlan/worktree-task-workspace

[English](README.md) | 中文

## 概述
本 Host 桥接包把每个已落地的 Worktree Task checkout 注册为 Workspace，用任务名作为标题，把它链接到任务源路径上注册的 Workspace，并通过注册表自身的 `attachSession` 校验把任务的会话入账。父级与任务关系只存放在本包自己的存储域里；Workspace 注册表的记录和会话持久化 schema 保持不变。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包
将本服务与 `storageDomain`、`workspaceRegistry`、`sessionPersistence` 提供方一起挂载为 `ctx.worktreeTaskWorkspaces`。启动时会可选读取 `worktreeTask` 提供方，扫描已经处于 active 状态的任务。桥接包在单一串行队列上消费已提交的 `worktree-task/changed` 转换；某一步失败只记日志，绝不会让发出该事件的 task 操作失败。

对每个 `created` 或 `activated` 转换，桥接包执行一次 `ensure`：checkout 目录不存在时直接跳过（下次激活会重试）；否则在 checkout 路径上创建 Workspace，仅对全新注册用任务名设置标题，解析父级 Workspace（任务记录的 id 在其路径仍等于源路径时优先，否则取注册在源路径上的 Workspace，再找不到就不写父级），并把链接写入 `worktree_task_workspaces` 域的 `links` 表。`bound` 转换先执行 `ensure`，再在会话头已存在时入账该会话；入账被拒绝只记日志。`unbound`、`hibernated`、`archived`、`deleted` 转换有意保留注册和链接，这样已入账的会话在目录缺失时仍保留分组；删除注册交给用户通过注册表自身的删除操作完成。

某个 checkout 的第一次 `ensure` 还会执行一次性补账：任务的已绑定会话，加上存储会话中规范化 cwd 等于 checkout 路径的会话，跳过已被其他 Workspace 入账的会话。补账期间的入账失败只记日志，不会中断剩余候选。

只读访问使用 `links()`（投影 checkout Workspace 仍然注册着的存储链接；父级注册被删除时省略父级字段）和 `settled()`（当前队列尾部处理完后即 resolve）。每次持久化链接变化都会发出 `worktree-task-workspaces/changed`（`@mode emit`）。

<a id="model-experience"></a>
## 模型体验

无直接影响；Workspace 标题和分组只有被消费者选择纳入时才会传给模型。

#### KV Cache 影响

无直接影响；链接集合是 Host 侧簿记数据，本身不会进入模型请求。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- 已归档和已删除的任务没有 checkout 目录，其会话无法补账；桥接包安装前创建的会话除非任务重新激活，否则保持未入账。
- 会话头尚不存在的 `bound` 转换（agent-team 先绑定后创建会话）只记日志、不入账；该会话继承父会话的 cwd，继续作为子代理存在，直到后续转换或补账覆盖它。
- 任务 checkout Workspace 会像普通 Workspace 一样出现在 Workspace 选择器和搜索里；注册表没有一等的"任务"类型。
- 通过任务分组行新建的会话会计入 Workspace 的账，但不写入 `task.sessionIds`，因此不会阻止休眠。
- 桥接包从不删除 Workspace 注册；用户通过注册表的删除操作移除后，链接会从 `links()` 消失，存储记录仍保留。

不发布 runtime invariant companion，因为权威链接状态通过服务的 `links()` 方法观察，而不是通过独立 invariant 流。

<a id="dev-note"></a>
### 开发备注

桥接包只拥有自己的 `worktree_task_workspaces` 域；除 `create`/`setTitle`/`attachSession` 外从不写注册表记录，也从不修改 task 记录。
