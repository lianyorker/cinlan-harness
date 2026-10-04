# Agent Note: Agent Team worktree integration

Status: implemented

English | [中文](2026-10-04-agent-team-worktree-integration.zh.md)

## Problem

Agent Teams can preserve roster, mailbox, and task state while several teammates run concurrently, but inherited working directories let independent writers interfere. Worktree Task already owns isolated branches, bounded checkout lifecycle, review, and safe deletion, yet a Team Lead cannot turn a completed teammate branch into source-branch state. Deleting the checkout directly leaves an unmerged branch; deleting the Session loses the collaboration history; asking the model to run raw Git bypasses the provider's path, cleanup, and settlement rules.

A successful merge also crosses two durable owners. Worktree Task owns the branch and source checkout, while the Lead Session owns roster state. A crash between Git integration and task deletion must not make the merge repeat or leave the teammate writable after its checkout is reclaimed.

## Decision

Inherited cwd remains the default. An explicit `workspaceMode: 'worktree'` creation uses `ctx.worktreeTask` to create and bind a dedicated checkout. This mode also requires `ctx.workspaceRegistry` before integration so the teammate Session can become durable read-only history. Default profiles do not mount these optional rows.

The Lead-only `team_merge_worktree` operation accepts an inactive worktree teammate by immutable name. It drains the continuation, unbinds the child Session, and asks Worktree Task to merge its provider-issued task id. The Git provider runs captured cleanup once, checkpoints uncommitted task changes, archives and removes the checkout, requires the recorded source checkout to be clean and on the recorded branch, and integrates the managed branch with hooks disabled. A conflict is aborted before returning failure; the archived task and branch remain available for review and retry. Callers never supply repository, checkout, or branch paths.

After Git integration, Workspace archives the teammate Session with activity stopping enabled. The Lead log then records `workspaceMode: 'integrated'` plus the task id, branch, source branch, and source commits before and after integration. Task deletion follows that commit point. Successful deletion removes only the task id from the roster record; the integration facts and archived Session remain. If deletion or the process fails after the Team event, repeating `team_merge_worktree` resumes cleanup from that durable record without invoking Git merge again. A missing task after that commit point counts as completed cleanup.

The Worktree Task Remote and loopback Settings UI expose the same merge operation for human review. The Team projection cache version advances so cached roster state cannot omit the integration fields.

## Alternatives considered

**Keep every teammate in the Lead checkout.** Rejected as the only mode because independent commands, formatters, and generators can overwrite one another despite advisory write scopes. It remains the default for low-overhead collaboration.

**Use Workspace Isolation leases inside Agent Teams.** Rejected because Agent Teams already persists Worktree Task ids and binds child Sessions through that service. Introducing a second checkout identity would split lifecycle and cleanup ownership.

**Return branch paths and let the Lead run Git tools.** Rejected because opaque task ids prevent path authority from escaping the provider, and raw commands cannot preserve cleanup receipts or reliably abort conflicts.

**Delete the teammate Session after merge.** Rejected because conversation and tool history are useful review evidence. Workspace archival supplies an existing execution gate while preserving that history.

## Consequences

A Team composition that mounts Worktree Task and Workspace can run isolated teammates through completion and integrate them without manual branch discovery. The source checkout must remain clean and on the branch captured when the task was created. Integration is local to one Host and one Git repository; it is not a distributed merge coordinator or a filesystem lock.

The Team log gains an additive integrated-member state. Existing Team logs replay unchanged. Newer logs containing integrated records require a build that understands this experimental state; downgrade support is not provided. The archived Session can be reviewed from history, while ordinary Team messaging rejects it and the Workspace archive gate prevents new model steps unless an operator explicitly unarchives it.
