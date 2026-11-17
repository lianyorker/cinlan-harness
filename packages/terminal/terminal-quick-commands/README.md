---
description: "Durable per-host terminal quick commands with validation and host-scoped readback"
kind: "package-reference"
---
# @cinlan/terminal-quick-commands

English | [中文](README.zh.md)

## Summary

Durable per-host terminal quick commands: the service owns stored records and their validation; running a command belongs to the terminal that receives it, so this service never executes anything itself. Every read is scoped to one execution host — a cached list cannot be replayed against a different host.

## Use this package

Mount `ctx.terminalQuickCommands` with a `storageDomain` provider. `list(hostId)` returns that host's commands oldest-first; `create`/`update`/`remove` mutate through one serialized queue and emit per-host change notifications to registered listeners. Drafts are validated before write (`validateDraft`).

## Model Experience

None, as the service registers no prompt, tool, or Session event; quick commands are user terminal state, not model input.

#### KV Cache effect

No direct effect; stored commands enter a model request only if a terminal consumer chooses to include them.

## Known Limitations and Deferred Work

- Execution is out of scope: dispatching a stored command to a PTY is the receiving terminal's job.
- Lists are host-scoped by design; there is no cross-host aggregation view.
