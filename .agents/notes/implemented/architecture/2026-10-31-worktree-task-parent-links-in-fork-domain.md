# Agent Note: Worktree task parent links live in the fork domain, not the official WorkspaceRecord

Status: implemented

English | [中文](2026-10-31-worktree-task-parent-links-in-fork-domain.zh.md)

> Scope: where the parent–child relation between a Worktree Task checkout Workspace and its source Workspace is stored and served, and why the official `WorkspaceRecord` schema stays untouched. The implementation plan lives in docs/dev/工作树会话归属/plan.md.

## Problem

A Worktree Task creates a checkout Workspace that is logically a child of the source Workspace it branched from. The sidebar needs to render that nesting, and the client needs a durable, restart-safe way to know which Workspace is a task checkout and which Workspace is its parent. The obvious-looking fix is to add parent/kind fields to the official `WorkspaceRecord` and teach the official `WorkspaceRegistry` about hierarchy — but that schema belongs to upstream, and the fork rule forbids scattering Cinlan business logic inside official packages.

## Decision

The parent relation is fork-owned end to end:

- The bridge package `packages/workspace/worktree-task-workspace` persists each link in its own storage domain `worktree_task_workspaces` (version 1, table `links`, keyed by checkout Workspace id, carrying `taskId`, optional `parentWorkspaceId`, and `createdAt`). The official `WorkspaceRecord` gains no fields, and `packages/workspace/workspace` is not modified — including the `attachSession` cwd validation in `src/entity.ts`, which stays exactly as upstream ships it.
- The bridge reacts to `worktree-task/changed` events, registers the checkout Workspace, resolves the parent by source path, backfills sessions whose header cwd equals the checkout path, and emits `worktree-task-workspaces/changed`.
- The API layer projects links through `WorktreeTaskController.followWorkspaceLinks` (`@Remote({ mode: 'stream' })`, baseline + changed frames, each a complete set), classified owner-only in liveshare. The stream observes both link changes and committed task transitions because a task's status can change without changing its Workspace link.
- The client consumes the stream in `ui-worktree-task`, feeds the parent map into the official `uiWorkspace.registerParentHints` extension point, and renders task badges through the `sidebar.workspaces.group.trailing` slot. The official ui-workspace changes are generic extension points only (see plan 2.7).

Uninstalling the bridge degrades cleanly: task Workspaces become ordinary top-level workspaces and the links table is harmless orphan data; no official schema was ever changed.

## Alternatives considered

- **Add parent/kind fields to the official `WorkspaceRecord` and teach `WorkspaceRegistry` hierarchy.** Rejected: it changes an upstream-owned durable schema and scatters Cinlan workspace-tree logic inside official packages, violating the fork boundary rule; every upstream sync would carry merge risk for a schema the upstream does not want.
- **New `workspace-hierarchy` client package that derives parents from paths at render time.** Rejected in favor of B': path-derived nesting is implicit and breaks when a checkout moves or a workspace is re-registered; the explicit link record survives restarts and directory moves, and the official ui-workspace already gained a generic `registerParentHints` seam instead of a second competing hierarchy source.
- **Make `bindSession` also call `attachSession`.** Rejected: at bind time the child session header does not exist yet (agent-team binds before creating the session), so the attach would fail; attach happens later, once the session exists with the checkout cwd.

## Consequences

- The relation is durable and restart-safe, and the child session's cwd is persisted in its session header (agent-team passes `createdTask.checkoutPath` as the activation `cwd`), so membership can be reconstructed from the session log alone.
- Cost: two sources of parent information can coexist — explicit hints from the links table and the official path-derived grouping. The official merge policy (explicit hints win, stable snapshot identity) keeps this deterministic; the bridge filters links whose Workspace was deleted by the user.
- The fork owns one more storage domain; upstream schema migrations never interact with it.
