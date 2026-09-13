---
description: "Model-facing Browser element selection and verified crop capture tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-browser-element-capture

English | [中文](README.zh.md)

## Summary

This Consumer adds `browser_select_element` and `browser_capture_element` to the persistent [`ctx.browser`](../browser/README.md) capability. Selection calls the Browser Provider directly; capture submits a JSON-safe task to the process-local Coordination service so the Host executor owns Browser I/O and attachment persistence.

The default Cinlan Web composition mounts these tools and the capture executor with the Cinlan CLI Provider. Other compositions can mount them with the independent Playwright Provider.

## Table of Contents

- [Tools and data flow](#tools-and-data-flow)
- [Configuration](#configuration)
- [Permissions and cancellation](#permissions-and-cancellation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="tools-and-data-flow"></a>
## Tools and data flow

| Tool | Arguments | Result |
|---|---|---|
| `browser_select_element` | `page_id` | Temporary `selection_id`, element text metadata, and visible bounds. |
| `browser_capture_element` | `page_id` plus either `observation_id` and `element_id`, or `selection_id` | Request identity, `verified: true`, and one durable image attachment reference. |

Capture rejects mixed, incomplete, empty, or padded target ids before task creation. The Coordination input contains only string-valued JSON fields for page, target, and format. The executor output contains only `attachmentId`, `mediaType`, `bytes`, `width`, `height`, and optional `name`; the Consumer combines that metadata with the validated request identity after the run succeeds.

The Consumer requires the exact provider/model route to declare image input before capture execution and hides only `browser_capture_element` when prompt assembly cannot prove that capability. Nested and PTC dispatch defer the same durable image as plugin user context so the next model request receives the capture once.

<a id="configuration"></a>
## Configuration

| Key | Default | Meaning |
|---|---|---|
| `timeoutMs` | `60000` | Cooperative timeout metadata attached to both tools. |
| `screenshotFormat` | `png` | Element-crop encoding requested from the Provider (`png` or `jpeg`). |

Unknown keys, invalid formats, non-positive or unsafe integers, and timer values above the supported delay fail during plugin setup.

<a id="permissions-and-cancellation"></a>
## Permissions and cancellation

Both tools use the Browser permission policy's `observe` class and remain subject to its ToolRuntime guard. Coordination scheduling does not replace that decision. Caller cancellation requests run cancellation and then waits for the executor to settle before returning the tool error, preventing a capture from persisting after the caller observes completion.

<a id="model-experience"></a>
## Model Experience

### Browser element capture system prompt

#### What the model sees

The Consumer adds fixed English guidance for choosing observation ids or a temporary human selection and for refreshing stale page identity.

##### Capture guidance

```markdown
Use browser_select_element when a person must identify an element through a temporary hover highlight. Use browser_capture_element with either the exact observation_id and element_id from browser_snapshot or the selection_id from browser_select_element. The provider verifies element identity and visible bounds around capture; obtain a new snapshot or selection after the page changes.
```

#### Token effect

The fixed guidance adds a stable request-prefix cost while the Consumer is enabled.

#### KV Cache effect

The guidance remains reusable while plugin configuration and tool visibility stay unchanged; enabling, disabling, or filtering the Consumer changes the prefix from the first affected token.

### Browser element capture tool definitions

#### What the model sees

The model receives `browser_select_element` for one human-selected element and receives `browser_capture_element` only on an image-capable route. Timeout and image format remain deployment configuration rather than model arguments.

#### Token effect

The two fixed definitions add stable prefix tokens when visible; a text-only route retains only the selection definition.

#### KV Cache effect

The definitions preserve the existing prefix while route capability and plugin configuration are unchanged. Route-dependent capture visibility can change reuse from the first omitted or added tool token.

### Browser element capture results

#### What the model sees

Selection returns fixed English text with the selected page, `selection_id`, role, name, and bounds. Capture returns fixed English text with the page, exact target, image media type, dimensions, and byte count, followed by the durable image block; stale or changed elements return an ordinary tool failure and no attachment result.

#### Token effect

Selection and capture metadata add data-dependent text. A successful crop also adds model-provider-specific image input cost without sending a second full-page image.

#### KV Cache effect

Tool results append after the reusable request prefix. A new selection or capture changes only suffix history until compaction.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The Cinlan CLI Provider supports human selection and selection-bound capture; observation refs return `BROWSER_FEATURE_UNSUPPORTED`. See [Provider capture semantics](../browser-cinlan/README.md#element-selection-and-capture).
- Selection ids are process-local, temporary, and consumed by capture; they are not durable Session entities.
- The current capture has no padding, annotation, full-page mode, script evaluation, or independent element-text extraction.
- Human selection requires a visible Browser Provider UI.

<a id="dev-note"></a>
### Dev Note

No runtime invariant companion is published because the Consumer retains no independent relationship after a call: Browser owns target freshness, Coordination owns task settlement, AttachmentStore owns durable bytes, and ToolRuntime owns call/result logging.
