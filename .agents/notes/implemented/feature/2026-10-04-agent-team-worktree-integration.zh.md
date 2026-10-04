# Agent Note：Agent Team worktree 集成

Status: implemented

[English](2026-10-04-agent-team-worktree-integration.md) | 中文

## 问题

Agent Teams 能在多个 teammate 并发运行时保留 roster、mailbox 与 task 状态，但继承工作目录会让独立写入者相互干扰。Worktree Task 已经拥有隔离分支、有界 checkout 生命周期、审查与安全删除，但 Team Lead 不能把已完成的 teammate 分支转化为源分支状态。直接删除 checkout 会留下未合并分支；删除 Session 会丢失协作历史；让模型运行原始 Git 会绕过 Provider 的路径、cleanup 与结算规则。

成功合并还跨越两个持久 owner。Worktree Task 拥有分支与源 checkout，Lead Session 拥有 roster 状态。Git 集成与任务删除之间发生崩溃时，不能重复合并，也不能在 checkout 已回收后让 teammate 继续写入。

## 决策

继承 cwd 保持默认值。显式选择 `workspaceMode: 'worktree'` 时，创建操作使用 `ctx.worktreeTask` 创建并绑定独立 checkout。该模式在集成前还要求 `ctx.workspaceRegistry`，以便把 teammate Session 变成持久只读历史。默认 profile 不挂载这些可选 row。

仅限 Lead 的 `team_merge_worktree` 操作通过不可变名字接受一个 inactive worktree teammate。它 drain continuation、解绑 child Session，并让 Worktree Task 使用 Provider 签发的 task id 执行合并。Git Provider 只执行一次捕获的 cleanup，checkpoint 未提交的 task 变更，归档并移除 checkout，要求记录的源 checkout 保持干净且位于记录分支，并在禁用 hook 的情况下集成受管分支。冲突会在返回失败前中止；已归档任务与分支继续保留，供审查和重试。调用方不能提供 repository、checkout 或 branch 路径。

Git 集成完成后，Workspace 会在启用停止活动的情况下归档 teammate Session。随后 Lead 日志记录 `workspaceMode: 'integrated'`，以及集成前后的 task id、分支、源分支和源提交，再删除任务。删除成功只从 roster 记录移除 task id；integration 事实与已归档 Session 保留。Team event 之后删除失败或进程中断时，再次调用 `team_merge_worktree` 会从该持久记录继续清理，不会再次调用 Git merge。提交点之后 task 已缺失时视为清理完成。

Worktree Task Remote 与 loopback Settings UI 暴露同一个 merge 操作供人工审查。Team projection cache version 随之升级，避免缓存 roster 状态遗漏 integration 字段。

## 考虑过的替代方案

**让所有 teammate 留在 Lead checkout。** 拒绝把它作为唯一模式，因为即使存在提示性 write scope，独立命令、formatter 与 generator 仍会相互覆盖。它继续作为低开销协作的默认值。

**在 Agent Teams 内使用 Workspace Isolation lease。** 拒绝，因为 Agent Teams 已通过 Worktree Task 服务持久化 task id 并绑定 child Session。引入第二种 checkout 身份会拆分生命周期与 cleanup owner。

**返回分支路径并让 Lead 运行 Git 工具。** 拒绝，因为不透明 task id 防止路径权限逃逸出 Provider，而原始命令无法保留 cleanup receipt 或可靠中止冲突。

**合并后删除 teammate Session。** 拒绝，因为对话与工具历史是有用的审查证据。Workspace 归档提供已有执行门，同时保留该历史。

## 后果

挂载 Worktree Task 与 Workspace 的 Team 组合可以让隔离 teammate 运行到完成并完成集成，无需人工发现分支。源 checkout 必须保持干净，并位于创建任务时捕获的分支。集成只在一个 Host 和一个 Git repository 内生效；它不是分布式 merge coordinator 或文件系统锁。

Team 日志增加 additive integrated-member 状态。既有 Team 日志保持可回放。包含 integrated 记录的新日志要求构建理解该实验状态；不提供 downgrade 支持。已归档 Session 可以从历史中审查，普通 Team 消息会拒绝它，而 Workspace archive gate 会阻止新的模型 step，除非 operator 显式取消归档。
