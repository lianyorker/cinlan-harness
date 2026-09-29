# Agent Note: Agent Teams 工具命名消歧与 Worktree 任务隔离

Status: implemented

[English](2026-09-29-agent-teams-tool-disambiguation-and-worktree-isolation.md) | 中文

## 问题

当 `@deepseek-ai/dsh-experimental-tool-agent-team` 与通用子 Agent 控制工具（`@deepseek-ai/dsh-tool-subagent-control`）一同挂载时，`send_message`、`list_agents` 与 `interrupt_agent` 上的命名冲突会覆盖所有成员的全局委派控件，阻碍了将团队协作与分层委派相结合的组合架构。此外，多个 teammate 在 Lead 的根仓库中并发操作时，在缺乏隔离工作目录的情况下编辑相邻文件存在文件竞态与 git index 冲突风险。

## 决策

在 `@deepseek-ai/dsh-experimental-tool-agent-team` 中通过 `toolNaming: 'override' | 'team-prefixed'` 引入可配置的工具命名策略。在 `'team-prefixed'` 模式下，团队工具注册为 `team_send_message`、`team_list_agents`、`team_wait_agent` 与 `team_interrupt_agent`，保留调用方目录中的旧全局控制工具，并动态调整系统提示词策略与无进展指引。

在 `spawnTeammate` 中支持 `workspaceMode: 'inherit' | 'worktree'`，将 `@deepseek-ai/dsh-experimental-agent-team` 与 `ctx.worktreeTask` 进行联动。当选择 `'worktree'` 模式时，roster 协调器校验服务可用性，创建隔离的 Git worktree 与分支，绑定子会话，并在 teammate 销毁或创建回滚时自动释放分配的 worktree。`task-board.ts` 中的去重任务板函数直接委托给 `task-view.ts`。

`projection.ts` 中的投影模式严格校验 `teamMemberSnapshotSchema` 中的 `workspaceMode` 与 `worktreeTaskId`，确保在 provisioning、active 与 failed 生命周期状态间强制执行不可变身份契约。

## 备选方案

**无条件强制使用带前缀的工具名。** 破坏依赖规范 `send_message` 的既有提示词与测试套件会违反实验性 team profile 的向后兼容性。可配置策略为多控制环境提供了非破坏性接入能力。

**在 agent-team 内部自行手写 git worktree 分支管理。** 手写 git 操作会重复 `@deepseek-ai/dsh-worktree-task` 的既有能力，违反仓库依赖复用策略。委托给专用服务可保证一致的生命周期与清理语义。

**允许在 teammate 创建后变更 workspaceMode。** 跨目录重置活动 agent 会话的工作目录存在丢失文件缓存一致性与在途子进程句柄的风险。工作区模式必须作为不可变配置属性保留。

## 结果

- `@deepseek-ai/dsh-experimental-tool-agent-team` 在 `toolNaming: 'team-prefixed'` 下与 `@deepseek-ai/dsh-tool-subagent-control` 干净共存。
- teammate 可以在隔离的 worktree 中执行并发文件系统变更，不会发生竞态或覆盖 Lead 的未提交修改。
- 销毁与创建回滚流程通过 `worktreeTask.delete` 自动回收已分配的 worktree。
- 所有受修改的实验包维持 100% 测试覆盖率。

### 风险

Worktree 创建依赖可选的 `@deepseek-ai/dsh-worktree-task` 服务；缺乏 git 或 worktree 隔离的环境将以 `TEAM_WORKTREE_UNAVAILABLE` 显式失败。
