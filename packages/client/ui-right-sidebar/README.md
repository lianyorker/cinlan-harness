---
description: "Right sidebar contributors for review, worktree tasks, browser, ports forwarding, and line comments."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-right-sidebar

English | [中文](README.zh.md)

## Summary
This plugin contributes Review, Tasks, Browser, and Ports discovery and forwarding pages to the production right sidebar, as well as an Editor & Diff Preferences row to General Settings. The canonical Files page is owned by ui-sidebar-files, and Terminal is decoupled into ui-sidebar-terminal. The Review page provides Workspace Isolation diff inspection (supporting inline and side-by-side presentation, word wrap, and whitespace toggle), structured line comments, and injection into the Session agent prompt queue. The Ports page discovers listening TCP ports on the remote workspace target and manages loopback port forwarding rules with conflict detection and disconnect teardown.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package
Mount the plugin with ui-sidebar-right, ui-sidebar-files, locale, the official Remote assembly, and the relevant Host controllers. The contributor slots use session-scoped injection and return typed loading, error, empty, and mutation states.

<a id="model-experience"></a>
## Model Experience

The Review contributor allows users to dispatch structured line review comments into the active Session agent prompt queue via remote.session.prompt; other tabs register no prompt, tool, or Session event.

#### KV Cache effect

Comments dispatched to the agent queue append text context to subsequent model turns.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Browser content is limited to the mounted Host Remote namespaces and does not create arbitrary process or filesystem authority.
- The restricted Browser page accepts only validated HTTP(S) URLs and does not provide cross-origin DOM access.

No runtime invariant companion is published because the package owns browser component state while sidebar ownership and lifecycle are enforced by ui-sidebar-right.

<a id="dev-note"></a>
### Dev Note

Do not register a second conversation.session.header.corner contributor; extend the existing ExpandButton owner when adding a top-right tool.
