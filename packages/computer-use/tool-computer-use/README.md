---
description: "Model-facing desktop tools with typed results and optional screenshots."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-computer-use

English | [中文](README.zh.md)

## Summary

Model-facing desktop tools with typed results and optional screenshots.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)

<a id="use-this-package"></a>
## Use this package

This model-facing Consumer exposes the provider-neutral [`ctx.computerUse`](../computer-use/README.md) API as six grouped desktop tools. It owns tool names, JSON schemas, strict argument validation, timeout metadata, system guidance, result rendering, optional screenshot persistence, and generic UI render intent; it imports no concrete Provider.

## Tools

| Tool | Operations | Result |
|---|---|---|
| `computer_list_apps` | list applications | Application ids, names, process ids, running state, and optional bundle ids. |
| `computer_list_windows` | list one application's windows | Window ids, titles, dimensions, and available state fields. |
| `computer_observe` | accessibility observation | Fresh observation id, application/window identity, accessibility tree, element ids, and optional PNG attachment. |
| `computer_pointer` | click, scroll, drag | Fresh post-action observation and redacted action metadata. |
| `computer_keyboard` | type text, paste text, press key, hotkey | Fresh post-action observation and redacted action metadata. |
| `computer_accessibility` | secondary action, set value | Fresh post-action observation and redacted action metadata. |

Only application and window listing declare sibling concurrency safety. Every observation or action remains ordered because target focus, runtime generation, and observation freshness can change between calls.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `timeoutMs` | `60000` | Cooperative timeout metadata attached to every tool definition. |
| `maxTextChars` | `100000` | Maximum literal text or value length accepted by one keyboard or accessibility call. |

The model cannot choose either bound. Unknown keys, invalid timeout values, and non-positive or unsafe limits fail during plugin setup.

## Observation and screenshot admission

Every action requires the exact `app_id`, `window_id`, and latest `observation_id`. Element targets must come from that observation; point targets use non-negative window-local coordinates. Each action returns a fresh observation, so the prior observation and all of its element ids expire immediately.

Before requesting a screenshot, the Consumer requires the attachment policy to accept PNG and the exact calling provider/model route to declare image input through `ctx.llm`. When either fact is unavailable, the call continues with the accessibility tree and asks the Provider to skip screenshot capture. Accepted screenshots are saved through `ctx.attachments` and returned as native `ImageBlock` content; this path does not use MCP. Attachment persistence failure is reported beside the textual observation rather than discarding the tree.

Literal text and values are bounded before Provider dispatch and are not echoed in result summaries, but the ordinary `tool/call` event still records model-supplied arguments in the Session log.

## Render intent

Every tool declares a pure `card: 'generic'` pending view with a read or execute kind. Desktop controls are not terminal output, diffs, filesystem locations, or persistent Browser presentation.

## Model Experience

### Computer Use system prompt

#### What the model sees

The plugin adds one fixed section that distinguishes local desktop applications from persistent Browser pages and requires observation freshness.

##### Computer Use guidance

```markdown
Use computer_* tools for local desktop applications, native windows, browser chrome, and webviews. Run computer_observe before every action and use only its exact observation_id, window_id, and element ids. Every action returns a fresh observation; prior element ids immediately expire. Prefer accessibility actions and element ids over coordinates. Typed text and set values are not echoed in result summaries. Persistent web-page automation remains a separate browser_* capability.
```

#### Token effect

The fixed guidance adds a stable request-prefix cost while the plugin is enabled.

#### KV Cache effect

The prompt prefix remains stable while the plugin stays loaded with unchanged visibility. Enabling, disabling, or reloading the plugin can invalidate reuse from the first changed prompt token.

### Computer Use tool schemas

#### What the model sees

The model receives the six schemas listed in the generated [`@deepseek-ai/dsh-tool-computer-use`](../../../docs/tool-catalog.md#deepseek-aidsh-tool-computer-use) catalog section. Action subtypes share pointer, keyboard, and accessibility tools so permission classes remain explicit without creating one schema per Provider operation.

#### Token effect

The six fixed definitions add a stable request-prefix cost while the tools are visible.

#### KV Cache effect

The definitions preserve a reusable prefix while configuration and tool visibility remain unchanged. Changing visibility or a definition invalidates reuse from the first changed tool token.

### Desktop observations and action results

#### What the model sees

Results identify the current observation, application, window, dimensions, screenshot status, accessibility tree, and redacted action path or verification. Image-capable routes may also receive one durable PNG image block. Typed text and set values are not repeated in result summaries; failures retain the ordinary `Error: <message>` form and structured harness metadata.

#### Token effect

Application lists, window lists, and accessibility trees are data-dependent and remain in Session history until compaction. Optional screenshots add attachment metadata and image input cost according to the selected model Provider.

#### KV Cache effect

Results append after the reusable request prefix and preserve an existing prefix entry.

## Known Limitations and Deferred Work

- The six schemas remain visible even when the selected Provider advertises an unsupported action; that call fails through the Provider at execution time.
- Screenshot capture is opportunistic. Text-only or unknown-capability model routes receive accessibility observations without an image rather than a model-capability error.
- The Consumer has no application allowlist, secret-field detection, credential-entry workflow, OCR tool, display selector, move/resize tool, menu-specific tool, or durable desktop lease.
- This suite is opt-in and does not register persistent Browser, Mobile Device, Android/iOS emulator or simulator, Speech/Audio, microphone, speaker, STT, or TTS tools.

No runtime invariant companion is published: provider registration, protocol validation, and observation freshness are enforced by their owning operations and covered by the package tests.

### Dev Note

None.
