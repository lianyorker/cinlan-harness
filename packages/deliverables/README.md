---
description: "The deliverables package group: per-turn workspace change recording and comparisons for users and maintainers choosing a recorder."
kind: "package-group"
---

# packages/deliverables

English | [中文](README.zh.md)

## Summary

This group lets clients show which workspace files changed during a turn and compare their contents. The workspace-changes package records git snapshots and file-tool captures, then serves summaries and comparisons for each live Session. Choose it when users need to review a turn's file changes. The Web deliverables plugin renders the results.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The group owns workspace change recording; client presentation lives with the Web plugins.

| Package | Role |
|---|---|
| [workspace-changes](workspace-changes/README.md) | Records changed files per turn and serves summaries and per-file comparisons |

<a id="related-documentation"></a>
## Related documentation

- [Web deliverables](../client/ui-deliverables/README.md) — displays turn results.
- [Session subsystem](../../docs/subsystems/session.md) — durable events announcing completed work.
- [Subprocess capability](../subprocess/README.md) — manages git processes.

<a id="dev-note"></a>
## Dev Note

None.
