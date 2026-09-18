---
description: "Read-only Git capability family for bounded repository observations."
kind: "package-group"
---
# git/ - read-only Git capability family

English | [中文](README.zh.md)

## Summary

Read repository identity, status, diffs, and logs through bounded Git observations without coupling consumers to mutation or isolation policy.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

The Git capability is split into a provider-neutral Service Definition, providers, and optional Consumers. It gives tools and workflows bounded repository observations without coupling them to branch, worktree, or mutation policy.

| Package | Role | `ctx` key |
|---|---|---|
| [`git/`](git/README.md) | Repository identity, structured status, bounded diff and log | `ctx.git` |
| [`git-local/`](git-local/README.md) | Executes the configured Git binary through `ctx.subprocess` | registers `ctx.git` |
| [`tool-git/`](tool-git/README.md) | Model-facing `git_status`, `git_diff`, and `git_log` Consumer | registers on `ctx.tools` |

Commit, push, branch creation, and worktree isolation remain separate Consumers or provider seams. A composition can therefore use Git observations without creating a branch for every task.

<a id="dev-note"></a>
## Dev Note

The [Git subsystem reference](../../docs/subsystems/git.md) lists the generated Cordis API. The core Git capability remains read-only; Session-bound mutation contracts belong to the [Sidebar Git package](sidebar-git/README.md), while Workspace isolation is a separate capability.
