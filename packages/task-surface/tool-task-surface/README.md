---
description: "Model-facing show_task_surface tool for interactive human-in-the-loop task surfaces over the DeepSeek Harness session log."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-task-surface

English | [中文](README.zh.md)

## Summary

`dsh-tool-task-surface` provides the model-facing `show_task_surface` tool, enabling agents to request structured human input during multi-step execution. When invoked, the tool validates the declarative surface model against session limits, records the surface definition in the session log, concludes the turn to await human response, and formats completed answers into prompt context when the turn resumes.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package to equip agents with the `show_task_surface` tool. The agent uses this tool whenever structured user decisions, approvals, or multi-field forms are required before proceeding with further actions.

### When to choose it

Choose it when an agent needs structured input through typed interactive controls (such as text, choices, or checkboxes) rather than free-form conversational back-and-forth. Avoid it for unstructured open-ended questions where conversational messages suffice.

### Tool behavior

Calling `show_task_surface` validates the surface specification, appends the declaration to session history, and concludes the model turn. Execution is paused until the user submits responses or dismisses the surface.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The tool implementation coordinates model execution and projection state:

- **Turn barrier and conclusion**: The tool calls `exec.concludeTurn()` to yield execution to the human user while preserving session context.
- **Projection verification**: Before showing a surface, it checks `ctx.sessionProjections.stateOf(session, 'taskSurface')` to enforce the single-active-surface invariant.
- **Context generation**: Upon user submission, answers are formatted as Markdown prompts and injected into the resumed turn context.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Task surface group map](../README.md) — sibling packages and group architecture.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-task-surface) — the `show_task_surface` schema the model receives.
- [Task surface Agent Note](../../../.agents/notes/implemented/feature/2026-08-04-task-surface.md) — the unified task surface design and rationale.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [show_task_surface schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-task-surface): an object with `title`, optional `description`, `schemaVersion: 1`, and an array of `cells` specifying field components and validation criteria.

#### Token effect

Fixed schema cost on every request where the tool is visible; prompt tokens increase when the surface is active and upon user submission.

#### KV Cache effect

Prefix-stable while tool definition and visibility are unchanged in the session profile.

### Tool-call history and result

#### What the model sees

Each tool call records the full surface definition in its arguments. The tool returns a confirmation message upon submission, concluding the turn while waiting for user input.

#### Token effect

Surface definitions persist in the conversation history until compaction summarizes or prunes earlier turns.

#### KV Cache effect

Append-only; new tool call arguments and submission prompts follow the prefix and do not invalidate cached turn prefixes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the tool is a poor fit. They are current package constraints, not a task backlog.

- **Single active task surface per session** — presenting a second surface while one remains active is rejected until the active surface is resolved.
- **Whole-surface submission only** — partial answers or per-field streaming updates are not supported; the user submits all required fields together.
- **Client presentation requires projection support** — interactive rendering depends on `dsh-session-projection` being mounted in the session.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
