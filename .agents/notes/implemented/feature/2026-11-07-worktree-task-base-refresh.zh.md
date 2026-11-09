# Agent Note: Worktree Task 基线刷新偏好

Status: implemented

[English](2026-11-07-worktree-task-base-refresh.md) | 中文

## 问题

Git 设置页面显示已保存的基线刷新偏好，却拒绝编辑；Worktree Task 创建流程也跳过了已有的快进逻辑。禁用的控件使偏好失效，运行时文档也与提供方实现矛盾。

## 决策

Git 设置页面通过带 revision fence 的 Host Settings scope 保存和重置 `refreshLocalBaseRefOnWorktreeCreate`。启用后，Worktree Task 创建流程仅在当前检出的 `main` 或 `master` 同时也是请求的基准引用时，才会尝试抓取并快进该分支。存在本地独有提交、缺少上游或抓取失败时，分支保持不变。其他分支名和显式选择的其他引用不会触发刷新。

## 考虑过的替代方案

**移除该偏好。** 这会丢弃已有持久化字段和经过测试的提供方快进逻辑。启用现有字段可恢复用户明确选择，无需新增设置。

**刷新每个当前检出的分支，或解析每个基准引用前都刷新。** 这可能移动 feature branch，或在任务使用其他固定引用时修改 `main`。只刷新作为请求基准的当前检出 `main` 或 `master`，能让选项符合其名称并避免意外更新无关分支。

## 影响

设置现在可写入，并影响后续任务创建；不会改变已有任务或已记录的任务分支。提供方的抓取和快进仍是尽力操作，刷新不可用时任务继续使用请求的引用。该偏好默认关闭。

## 验证

Git 设置操作与页面测试覆盖带 revision fence 的保存、重置和可用开关。Worktree Task 提供方测试覆盖成功快进、保留本地独有提交，以及请求其他基准引用时跳过刷新。
