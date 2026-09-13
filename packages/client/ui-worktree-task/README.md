---
description: "Web Settings page for Worktree Task lifecycle administration."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-worktree-task

English | [中文](README.zh.md)

## Summary
This browser plugin adds a Worktree Task section to Web Settings when the Host exposes the official Remote namespace. It lists task records, refreshes authoritative state, activates and hibernates tasks, and reports typed provider errors without accepting filesystem paths or shell commands from the page.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount the plugin with the locale, Settings, and Remote assemblies. The page is enabled only for a loopback Host and sends opaque task ids to dsh-api-worktree-task-controller.

<a id="model-experience"></a>
## Model Experience

None, as the browser Worktree Task settings page registers no prompt, tool, or Session event.

#### KV Cache effect

None; task administration does not alter model requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Task creation and checkout configuration remain Host/provider responsibilities.
- The page uses explicit refresh and does not subscribe to task lifecycle events.

No runtime invariant companion is published because the page keeps only component-local interaction state and reloads authoritative Remote results.

<a id="dev-note"></a>
### Dev Note

Keep Cordis services in the registration module and pass typed locale and callbacks into components.
