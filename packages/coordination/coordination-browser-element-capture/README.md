---
description: "Coordination executor for verified Browser element image persistence."
kind: "package-reference"
---

# @deepseek-ai/dsh-coordination-browser-element-capture

English | [中文](README.zh.md)

## Summary

This Host plugin registers the `browser-element-capture` executor on `ctx.coordination`. It accepts a JSON-safe Browser target, calls the selected Browser Provider, and persists the verified crop through `ctx.attachments` without carrying Playwright handles, DOM nodes, overlay state, or image bytes through retained Coordination output.

## Table of Contents

- [Task contract](#task-contract)
- [Lifecycle](#lifecycle)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="task-contract"></a>
## Task contract

| Part | Fields |
|---|---|
| Executor kind | `browser-element-capture` |
| Observation input | `page_id`, `kind: observation`, `observation_id`, `element_id`, `format` |
| Selection input | `page_id`, `kind: selection`, `selection_id`, `format` |
| Successful output | `attachmentId`, `mediaType`, `bytes`, `width`, `height`, optional `name` |

Input must be JSON-safe and contain exactly the fields for its discriminant. The executor forwards the task `AbortSignal` to Browser capture, checks cancellation before persistence, saves the encoded bytes as `browser-element.png` or `browser-element.jpg`, verifies the returned attachment media type, and retains attachment metadata only.

Browser, validation, and attachment failures produce a failed task. Cancellation produces a cancelled task and never invents a successful attachment result.

<a id="lifecycle"></a>
## Lifecycle

The Host composition loads one executor registration. The registration is tied to the plugin fiber, so disposal or HMR unregisters the kind; active calls remain owned by the configured Coordination service's executor lifecycle.

<a id="model-experience"></a>
## Model Experience

### Consumer-rendered capture result

#### What the model sees

This executor contributes no prompt or tool definition. [`@deepseek-ai/dsh-tool-browser-element-capture`](../../browser/tool-browser-element-capture/README.md) renders the successful `browser_capture_element` result from the retained attachment metadata.

#### Token effect

The package adds no direct model tokens. The Consumer pays for result text and the single cropped image when capture succeeds.

#### KV Cache effect

Executor registration and task scheduling do not change the model request prefix; task-specific attachment metadata appears only in Consumer-rendered suffix history.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Crash recovery, task retention, and queue retry follow the configured Coordination Provider; this executor adds no separate persistence layer.
- The selected Browser Provider must implement the element-capture extension.
- Attachment persistence has no task-level retry after an uncertain storage failure.

<a id="dev-note"></a>
### Dev Note

No runtime invariant companion is published because the package contributes one effect-owned executor and retains no independent state; the Coordination service owns registration lookup and terminal task state.
