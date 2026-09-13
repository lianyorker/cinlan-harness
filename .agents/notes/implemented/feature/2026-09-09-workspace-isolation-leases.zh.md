# Agent Note: Git workspace isolation leases

Status: implemented

[English](2026-09-09-workspace-isolation-leases.md) | 中文

## Problem

Session 只能在已注册 Workspace 目录中执行。Web composition 没有 Git worktree provider，无法为 Session 创建独立 checkout、保留 branch，也无法把 managed checkout 映射回源 Workspace。

## Decision

Harness 提供 provider-neutral 的 `ctx.workspaceIsolation` contract 和本地 Git provider。Provider 为每个 Session 持久化一个 lease，在 `$DSH_HOME/worktrees/v1` 下创建 branch-backed checkout，支持 checkpoint、hibernate、activate、bounded inspect/compare，并在 branch 未集成时拒绝不安全 teardown。Workspace registry 通过 provider 的 `sourceFor(sessionId, cwd)` 观察将 managed checkout 归属到源目录；普通 Session 保持原行为。

`session.create` 接受 `isolate: true`。它解析 Workspace 或 cwd 作为源目录，获取 provider checkout，再以 checkout 作为 immutable cwd 创建 Session。Session 创建失败时执行 provider cleanup。Web bundle 挂载 provider、Remote controller 和本地 Settings 管理页。

Isolation provider 按 Session request opt-in，并与现有 Workspace record 分离。它不改变 Session JSONL format，也不修改 agent-loop 创建 protocol。

## Consequences

Provider 当前按一个 Session 对应一个 active lease 建模，并从源 checkout 当前 HEAD 创建。Start-from selector、ignored 文件共享、external worktree 导入和 Orca Review/Ship orchestration 仍是后续工作。Git 操作通过现有 subprocess capability 执行，使用清理后的 Git 配置和 bounded output。

## Alternatives considered

**向 Workspace record 增加 branch 和 checkout 字段。** 拒绝，因为 Workspace 管理目录注册和 Session 分组，lease 管理 Git lifecycle 和 cleanup。

**让 agent-loop 隐式创建 worktree。** 拒绝，因为 Session controller 已拥有 cwd admission，可以在不改变核心 lifecycle protocol 的情况下 opt-in isolation。

**接受浏览器提交的 checkout path 进行 cleanup。** 拒绝，因为 provider-issued lease id 能在每次 mutation 前执行 ownership 和 containment checks。

## Testing

Git provider suite 在 Windows 使用显式 30 秒 test timeout 后通过 18 个测试。Workspace registry tests 除两个缺少 symlink privilege 的既有 Windows symlink cases 外通过。
