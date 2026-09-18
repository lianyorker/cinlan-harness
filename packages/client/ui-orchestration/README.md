---
description: "Configure host tool parallelism and inspect evaluated workflow and delegation capabilities in agent presets."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-orchestration

English | [中文](README.zh.md)

## Summary

Use Orchestration settings to save the host’s parallel tool-call limit and inspect workflow tools, delegation tools, and workflow engines in each agent preset. Capability status comes from evaluated plugin rows, including disabled, conditional, pending, and failed entries. Preset files and workflow engine limits remain owned by their compositions.

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

Mount this browser plugin with the settings, locale, slots, and Remote services. It contributes the Orchestration page and has no plugin configuration fields.

Parallel tool calls writes `agent-loop.maxParallelToolCalls` through the settings scope. Save accepts positive whole numbers; Restore inherited value removes the user override. The host scheduler samples the committed value for its next tool-call group. Existing groups retain their captured limit, and PTC subcalls use a separate composition setting. Read-only or unavailable host settings disable editing. A rejected save retains the draft for explicit retry, including after a settings refresh.

Capability checks read the current host inventory. Configured means an enabled plugin without a live instance; Active describes its plugin lifecycle and does not verify provider connectivity. The page reports the host engine entry separately from each preset’s engine. The Web composition disables the host workflow engine and mounts engines inside its presets. Workflow concurrency and total-agent limits must be edited in the composition that owns the worker engine.

Search indexes localized field labels and explanations without current values or preset content. A workflow-limits search opens its disclosure before navigation locates the field.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The settings scope supplies the shared describe mirror, write serialization, revision fence, and reconnect recovery. The page keeps draft input separate from that observed state. Section metadata and its localized item descriptors register with the page slot and disappear on declaration collapse or plugin disposal.

The [coverage projection](src/client/view.ts) matches exact first-party module specifiers in the structured inventory. It does not parse composition text or execute expressions in the browser. [The registration](src/client/index.ts) connects these reads and mutations to [the page](src/client/OrchestrationSection.tsx).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These owners define persistence, composition, and execution semantics.

- [Settings](../ui-settings/README.md) — shared host settings mirror and mutation queue.
- [Agent presets](../ui-agent-preset/README.md) — read-only built-ins and custom preset copy, open, and delete operations.
- [Plugin inventory](../../host/plugin-inventory/README.md) — evaluated host and preset rows.
- [Agent loop](../../core/agent-loop/README.md) — tool-call scheduling.
- [Workflow worker engine](../../workflow/workflow-worker-thread/README.md) — composition-owned workflow limits.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the host agent loop, which consumes the saved execution limit; this browser plugin registers no model-facing tools or prompt sections.

#### KV Cache effect

None; reading capability status and saving the scheduler limit do not alter a running session’s prompt prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The page distinguishes observed composition from verified execution.

- Capability checks recognize first-party workflow and delegation module specifiers. Third-party replacements require their own capability reporting.
- Workflow engine configuration values are not exposed by the inventory API. The page cannot edit or report effective concurrency and total-agent ceilings for those engines.
- Provider connectivity remains unverified by plugin lifecycle status. Check again reloads the inventory after composition changes.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This browser plugin projects host-owned settings and inventory; its Node entry owns no independent mutable state.
