---
description: "The task-surface group map: declarative task surfaces, pure Session projection, and the show_task_surface tool, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/task-surface

English | [中文](README.zh.md)

## Summary

The task-surface group provides a unified declarative task surface abstraction for human-in-the-loop coordination during agent turns. It comprises two packages: @deepseek-ai/dsh-task-surface defines the domain model, validation rules, pure Session projection unit, and service registry; @deepseek-ai/dsh-tool-task-surface exposes the model-facing show_task_surface tool, which surfaces interactive forms and pauses execution until human submission or dismissal.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`task-surface`](task-surface/README.md) | Pure Session projection, declarative task surface model, and submission coordinator | `ctx.taskSurface` |
| [`tool-task-surface`](tool-task-surface/README.md) | Model-facing tool presenting task surfaces and pausing turns for user input | registers on `ctx.tools` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Session projection subsystem](../../docs/subsystems/session-projection.md) — the pure projection registry and client state model.
- [Generated tool catalog](../../docs/tool-catalog.md#deepseek-aidsh-tool-task-surface) — the `show_task_surface` schema the model receives.
- [Adding a tool cookbook](../../docs/cookbook/adding-a-tool.md) — tool conventions, presenter, and UI card presentation.
- [Task surface Agent Note](../../.agents/notes/implemented/feature/2026-08-04-task-surface.md) — the unified task surface design and rationale.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
