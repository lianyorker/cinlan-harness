---
description: "Terminal quick-commands management card for the workspace settings page"
kind: "package-reference"
---
# @cinlan/client-ui-quick-commands

English | [中文](README.zh.md)

## Summary

Terminal quick-commands management card for the workspace settings page: a browser-only contributor that renders the per-host command list and the create/edit/remove form over the `terminalQuickCommands` Remote.

## Use this package

Mount it in a composition that exposes the `terminalQuickCommands` Remote; the host entry `apply()` adds no Host state. The card lists commands for the selected execution host, validates drafts client-side for early feedback, and calls the Remote for every read and write — the host re-validates each mutation.

## Model Experience

None, as the browser-side settings card registers no model-facing input.

#### KV Cache effect

No direct effect; the card reads and edits user terminal state and never assembles a model request.

## Known Limitations and Deferred Work

- The card manages the stored list only; dispatching a command to a terminal belongs to the terminal surface.
- Draft validation mirrors the host rules for early feedback; the host's check remains authoritative.
