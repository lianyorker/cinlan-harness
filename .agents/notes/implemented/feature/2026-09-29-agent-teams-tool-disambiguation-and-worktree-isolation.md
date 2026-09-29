# Agent Note: Agent Teams tool disambiguation and Worktree task isolation

Status: implemented

English | [中文](2026-09-29-agent-teams-tool-disambiguation-and-worktree-isolation.zh.md)

## Problem

When `@deepseek-ai/dsh-experimental-tool-agent-team` mounts alongside generic subagent control tools (`@deepseek-ai/dsh-tool-subagent-control`), name collisions on `send_message`, `list_agents`, and `interrupt_agent` shadow global delegation controls for all members, preventing compositions from combining team collaboration with individual hierarchical delegation. Furthermore, concurrent teammates operating simultaneously in the Lead's root repository risk file race conditions and git index conflicts when editing adjacent files without isolated working directories.

## Decision

Introduce a configurable tool naming strategy in `@deepseek-ai/dsh-experimental-tool-agent-team` via `toolNaming: 'override' | 'team-prefixed'`. In `'team-prefixed'` mode, team tools register as `team_send_message`, `team_list_agents`, `team_wait_agent`, and `team_interrupt_agent`, preserving legacy global control tools in the caller's catalog while dynamically adapting system prompt policy and no-progress guidance.

Integrate `@deepseek-ai/dsh-experimental-agent-team` with `ctx.worktreeTask` by supporting `workspaceMode: 'inherit' | 'worktree'` in `spawnTeammate`. When `'worktree'` mode is selected, the roster orchestrator verifies service availability, creates an isolated Git worktree and branch, binds the child session, and cleans up the allocated worktree upon teammate teardown or creation rollback. Deduplicated task board functions in `task-board.ts` delegate directly to `task-view.ts`.

Projection schemas in `projection.ts` strictly validate `workspaceMode` and `worktreeTaskId` in `teamMemberSnapshotSchema`, ensuring immutable identity enforcement across provisioning, active, and failed lifecycle states.

## Alternatives considered

**Force prefixed tool names unconditionally.** Breaking existing prompts and test suites that depend on canonical `send_message` would violate backwards compatibility for experimental team profiles. A configurable strategy provides a non-breaking opt-in for multi-control environments.

**Hand-roll git worktree branch management inside agent-team.** Hand-rolling git operations duplicates existing capabilities in `@deepseek-ai/dsh-worktree-task` and violates the repository dependency reuse policy. Delegating to the dedicated service ensures consistent lifecycle and cleanup semantics.

**Allow changing workspaceMode after teammate creation.** Re-rooting an active agent session across directories risks losing file cache coherency and in-flight subprocess handles. Workspace mode must remain an immutable provisioning property.

## Consequences

- `@deepseek-ai/dsh-experimental-tool-agent-team` cleanly coexists with `@deepseek-ai/dsh-tool-subagent-control` under `toolNaming: 'team-prefixed'`.
- Teammates can execute concurrent filesystem modifications in isolated worktrees without race conditions or overwriting Lead changes.
- Teardown and creation rollback automatically reclaim allocated worktrees through `worktreeTask.delete`.
- 100% test coverage is maintained across all modified experimental packages.

### Risks

Worktree creation depends on optional `@deepseek-ai/dsh-worktree-task` service presence; environments lacking git or worktree isolation fail loudly with `TEAM_WORKTREE_UNAVAILABLE`.
