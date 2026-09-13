---
description: "@deepseek-ai/dsh-tool-browser"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-browser

English | [中文](README.zh.md)

## Summary

This package owns one layer of the persistent Browser capability; its detailed service, provider, policy, or tool contract is defined by the sections below.

## Table of Contents

- Summary
- Model Experience
- Known Limitations and Deferred Work
- Dev Note

This model-facing Consumer exposes the provider-neutral [`ctx.browser`](../browser/README.md) API as sixteen persistent-browser tools. It owns tool names, JSON schemas, HTTP(S) URL validation, timeout metadata, system guidance, result rendering, attachment persistence for screenshots, and generic UI render intent; it imports no concrete provider.

## Tools

| Tool | Arguments | Result |
|---|---|---|
| `browser_list` | none | Persistent page ids, indexes, URLs, titles, and active state. |
| `browser_open` | `url` | Opens an absolute HTTP(S) URL and returns `page_id`. |
| `browser_navigate` | `page_id`, `url` | Navigates one page and reports final URL/title. |
| `browser_snapshot` | `page_id` | Returns a fresh `observation_id`, accessibility tree, and scoped element ids. |
| `browser_click` | `page_id`, `observation_id`, `element_id` | Clicks one element from that exact observation. |
| `browser_screenshot` | `page_id` | Persists a PNG/JPEG viewport attachment and returns an image block. |
| `browser_close` | `page_id` | Closes one persistent page. |

`browser_list`, `browser_history`, `browser_network`, and `browser_downloads` declare sibling concurrency safety. Navigation, snapshot, click, screenshot, and closure retain ordering because page state and observation freshness can change between calls.

Home, search, back/forward, visits, network inspection, upload, download listings, and attachment saves use native extensions. browser_upload reads only files inside the calling Session workspace and sets an observed input; page input/change handlers may submit data. browser_save_download commits completed bytes as an attachment and returns metadata only. No model tool imports cookies.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `timeoutMs` | `60000` | Cooperative timeout metadata attached to every tool definition. |
| `screenshotFormat` | `png` | Provider screenshot encoding and attachment media type (`png` or `jpeg`). |

historyLimit defaults to 20, networkLimit to 50, and maxFileBytes to 4194304 for uploads and download saves. The model cannot choose timeouts or screenshot encoding. Unknown keys, invalid formats, and non-positive, non-integer, unsafe, or over-limit timeout values fail during plugin setup.

## Screenshot admission

Before browser I/O, `browser_screenshot` requires the deployment attachment policy to accept the configured media type and the exact calling provider/model route to declare image input through `ctx.llm`. This native image-capability lookup does not route the screenshot through MCP. The Consumer saves validated bytes through `ctx.attachments` before returning an `ImageBlock`; nested/code-mode dispatch additionally defers the same image as plugin context so the next model request receives it.

## Render intent

Every tool declares a pure `card: 'generic'` pending view with a read, fetch, execute, or delete kind. Browser controls are not terminal output, diffs, filesystem locations, or OS Computer Use presentation.

## Model Experience

### Browser system prompt

#### What the model sees

The plugin adds one fixed section that distinguishes persistent Browser operations, observation-scoped element ids, and OS Computer Use.

##### Browser guidance

```markdown
Use browser_* tools to inspect and operate persistent web pages in the configured browser. Element ids are valid only with the observation_id returned by the latest browser_snapshot for that page; take a new snapshot after navigation or interaction. These tools do not control OS windows or desktop applications; use a Computer Use capability for those targets.
```

#### Token effect

The fixed guidance adds a stable request-prefix cost while the plugin is enabled.

#### KV Cache effect

The prompt prefix remains stable while the plugin stays loaded with unchanged configuration and visibility. Enabling, disabling, or reloading the plugin can invalidate reuse from the first changed prompt token.

### Browser tool definitions

#### What the model sees

The model receives sixteen `browser_*` definitions for listing, opening, navigating, snapshotting, clicking, screenshotting, and closing persistent pages; timeout and screenshot encoding remain deployment configuration rather than model arguments.

#### Token effect

The sixteen fixed definitions add a stable request-prefix cost while the tools are visible.

#### KV Cache effect

The definitions preserve a reusable prefix while configuration and tool visibility remain unchanged. Changing visibility or a definition invalidates reuse from the first changed tool token.

### Browser tool results

#### What the model sees

`browser_list` renders one line per page, `browser_snapshot` identifies the observation and accessibility tree, and mutating results require a fresh snapshot before another element action. `browser_screenshot` returns a textual image summary plus a durable image attachment; failures retain the ordinary `Error: <message>` tool-result form and structured harness error metadata.

#### Token effect

Page lists and accessibility trees are data-dependent and remain in session history until compaction. Screenshots add attachment metadata and image input cost according to the selected model provider.

#### KV Cache effect

Results append after the reusable request prefix and preserve an existing prefix entry.

## Known Limitations and Deferred Work

- Text entry, scrolling, keyboard events, ordinary form filling, trace, and PDF remain unsupported; history/network retain bounded page-lifetime metadata.
- Explicit URL tools accept absolute HTTP(S); configured home also permits about:blank. File, data, and other custom schemes are rejected.
- Screenshot execution requires an image-capable model route and durable attachment service; unknown image capability fails closed.
- The suite is opt-in and does not register OS Computer Use or desktop-application tools.


<a id="dev-note"></a>
### Dev Note

The package keeps transport, policy, and model-facing responsibilities in their dedicated layers; generated artifacts are not hand-edited.

No runtime invariant companion is published because ToolRuntime owns logged call/result relations and Browser owns observation freshness.
