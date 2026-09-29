---
description: "Declarative task surface model, pure Session projection, and submission coordination service, for users and maintainers embedding or inspecting task surfaces."
kind: "package-reference"
---

# @deepseek-ai/dsh-task-surface

English | [中文](README.zh.md)

## Summary

dsh-task-surface provides declarative data models, bounds validation, a pure Session projection unit, and a host service for interactive task surfaces. Task surfaces let agents present structured forms to users and await input or dismissal. The package exports the taskSurface projection unit for real-time and replay views, along with TaskSurfaceService for managing active surfaces and resolving user submissions.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Task surfaces coordinate human input during agent executions. Host applications mount this package to validate surface declarations, project active task surface state onto client sessions, and manage submission lifecycles.

### Service API

| Member | Behavior |
|---|---|
| `getActive(session)` | Returns the currently active task surface and pending claim status for the session. |
| `submit(session, submission)` | Validates field values against the active surface schema and records a submitted session event. |
| `dismiss(session, dismissal)` | Dismisses the active task surface and records a dismissed session event. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package contains three key architectural components:

- **Declarative model and validation**: `TaskSurfaceModelV1` defines cell layouts and field schemas, enforced with bounds checking (`DEFAULT_TASK_SURFACE_LIMITS`).
- **Pure Session projection**: `taskSurfaceProjectionDefinition` projects task-surface events into active surface state, available to client subscribers.
- **Host coordination service**: `TaskSurfaceServiceImpl` tracks active surfaces and pending submissions across turn boundaries, clearing pending claims on user messages or dismissals.

</details>

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the tool-task-surface Consumer, which renders active task surfaces and submission prompts.

#### KV Cache effect

None; task surface service registration and projection state do not change the model request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only one task surface may be active per session; presenting a second surface while one remains active is rejected.
- Form submissions require all declared fields to satisfy validation; partial submissions are unsupported.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
