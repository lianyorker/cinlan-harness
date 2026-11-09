# Agent Note: Worktree Task base refresh preference

Status: implemented

English | [中文](2026-11-07-worktree-task-base-refresh.zh.md)

## Problem

The Git settings page exposed a saved base-refresh preference while rejecting edits, and Worktree Task creation skipped the existing fast-forward behavior. The disabled control made the preference ineffective and its runtime documentation contradicted the provider implementation.

## Decision

The Git settings page saves and resets `refreshLocalBaseRefOnWorktreeCreate` through the revision-fenced Host Settings scope. When enabled, Worktree Task creation may fetch and fast-forward the checked-out `main` or `master` branch only when it is also the requested base ref. A branch with local-only commits, a missing upstream, or a failed fetch remains unchanged. Other branch names and explicitly selected refs do not trigger this refresh.

## Alternatives considered

**Remove the preference.** This would discard an existing persisted field and the provider's tested fast-forward behavior. Enabling the field restores the user's explicit choice without adding a new setting.

**Refresh every checked-out branch or refresh before resolving every base ref.** This can move a feature branch or mutate `main` when the task uses a different pinned ref. Restricting refresh to the checked-out `main` or `master` that is itself the requested base keeps the option aligned with its name and avoids surprising unrelated updates.

## Consequences

The setting is writable and affects future task creation; it does not change existing tasks or recorded task branches. Provider fetch and fast-forward remain best-effort, and the task still uses the requested ref when refresh is unavailable. The preference defaults to false.

## Verification

The Git settings operations and page tests cover revision-fenced save, reset, and the live switch. Worktree Task provider tests cover successful fast-forward, preservation of local-only commits, and skipping refresh for another requested ref.
