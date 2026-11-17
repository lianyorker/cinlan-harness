---
description: "Read-write terminal quick-commands Remote over the durable per-host store"
kind: "package-reference"
---
# @cinlan/api-terminal-quick-commands-controller

English | [中文](README.zh.md)

## Summary

Read-write terminal quick-commands Remote over the durable per-host store. The adapter exposes `terminalQuickCommands` Remote methods — `list`, `create`, `update`, `remove` — to authenticated Client callers; the carrier authorizes callers, and the service owns no PTYs.

## Use this package

Mount `ctx.terminalQuickCommandsController` with `typert` and `terminalQuickCommands` providers. `list` returns the commands bound to one execution host plus the addressable host ids; writes return the stored record or a wire-safe failure reason.

## Model Experience

None, as the Remote adapter forwards client requests without registering prompt, tool, or Session content.

#### KV Cache effect

No direct effect; invoked Remote methods own any model-visible result.

## Known Limitations and Deferred Work

- Validation and storage semantics are delegated to `@cinlan/terminal-quick-commands`; this adapter adds no extra rules.
- There is no host-level fanout: each caller lists the hosts it can already address.
