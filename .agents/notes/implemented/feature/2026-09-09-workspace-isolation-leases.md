# Agent Note: Git workspace isolation leases

Status: implemented

English | [中文](2026-09-09-workspace-isolation-leases.zh.md)

## Problem

A Session could only execute in its registered Workspace directory. The Web composition had no provider that could materialize a Git worktree, retain its branch across hibernation, or map the managed checkout back to its source Workspace.

## Decision

The Harness provides provider-neutral `ctx.workspaceIsolation` contracts and a local Git provider. The provider persists one lease per Session, creates a branch-backed checkout below `$DSH_HOME/worktrees/v1`, checkpoints and hibernates inactive leases, activates retained leases, exposes bounded inspection and comparison, and refuses unsafe teardown when the branch is not integrated. The Workspace registry treats a managed checkout as belonging to its source directory through the provider's `sourceFor(sessionId, cwd)` observation; an ordinary Session remains unchanged.

`session.create` accepts `isolate: true`. It resolves the requested Workspace or cwd as the source directory, acquires the provider checkout, and creates the Session with the checkout as its immutable cwd. Provider cleanup runs when Session creation fails. The Web bundle mounts the provider, Remote controller, and local Settings management page.

The isolation provider is opt-in at the Session request and remains separate from the existing Workspace record. It does not change Session JSONL format or the agent-loop creation protocol.

## Consequences

The provider currently models one active lease per Session and starts from the source checkout's current HEAD. Start-from selectors, shared ignored files, external worktree import, and Orca Review/Ship orchestration remain separate work. Git operations run through the existing subprocess capability with scrubbed Git configuration and bounded output.

## Alternatives considered

**Extending Workspace records with branch and checkout fields.** Rejected because Workspace owns directory registration and Session grouping, while a lease owns Git lifecycle and cleanup.

**Changing agent-loop to create worktrees implicitly.** Rejected because the Session controller already owns cwd admission and can opt into isolation without changing the core lifecycle protocol.

**Accepting browser-supplied checkout paths for cleanup.** Rejected because provider-issued lease ids allow ownership and containment checks before every mutation.

## Testing

The Git provider suite passes all 18 tests on Windows with an explicit 30-second test timeout. Workspace registry tests pass except two existing Windows symlink cases when the process lacks symlink privilege.
