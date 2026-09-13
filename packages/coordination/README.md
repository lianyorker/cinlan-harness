---
description: "Task coordination capability family."
kind: "package-group"
---

# coordination/ - lightweight task coordination

English | [中文](README.zh.md)

## Summary

Coordinate small task graphs while choosing scheduling, execution, ownership, and isolation providers independently.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

## Packages

This capability coordinates a small directed acyclic graph of tasks. Scheduling stays provider-neutral; an executor may run a task in the current process or delegate it to a child agent. The capability reference is [`coordination/`](coordination/README.md).

| Package | Role | Runtime surface |
|---|---|---|
| [`coordination/`](coordination/README.md) | Task identity, graph validation, lifecycle, and extension contract | `ctx.coordination` |
| [`coordination-local/`](coordination-local/README.md) | Process-local scheduler with bounded concurrency | provides `ctx.coordination` |
| [`coordination-subagent-executor/`](coordination-subagent-executor/README.md) | One-shot subagent execution adapter | registers an executor kind |
| [`coordination-browser-element-capture/`](coordination-browser-element-capture/README.md) | Verified Browser element crop persistence adapter | registers an executor kind |
| [`tool-coordination/`](tool-coordination/README.md) | Model-facing DAG, status, wait, cancellation, and message Consumer | registers six tools on `ctx.tools` |

Messages, approval adapters, and audit projections are registered as independent listeners. Durable or remote coordination is deferred.

The shipped base and Web bundles do not mount Coordination. [`dsh-web-app`](../bundle/web-app/README.md) mounts the local scheduler, the worktree executor backed by the `spawn` subagent provider, and the model-facing tools with `worktree` as their default executor. Other compositions can mount the plain subagent executor or another registered executor kind. Removing the configured executor makes new runs fail with `EXECUTOR_UNAVAILABLE` instead of silently falling back.

<a id="dev-note"></a>
## Dev Note

No standalone subsystem page exists; the group and package READMEs own task-graph coordination documentation.
