---
description: "Right sidebar contributors for review, terminal, task, browser, and canonical file tools."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-right-sidebar

English | [中文](README.zh.md)

## Summary
This plugin contributes the Review, Terminal, Tasks, and Browser pages to the production right sidebar. The canonical Files page remains owned by ui-sidebar-files. The existing sidebar header-corner owner renders one integrated tools menu so Files, Review, Terminal, Tasks, and Browser open in the session whose button was clicked.

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

None, as the browser sidebar contributors register no prompt, tool, or Session event.

#### KV Cache effect

None; sidebar administration does not alter model requests.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Browser content is limited to the mounted Host Remote namespaces and does not create arbitrary process or filesystem authority.
- The restricted Browser page accepts only validated HTTP(S) URLs and does not provide cross-origin DOM access.

No runtime invariant companion is published because the package owns browser component state while sidebar ownership and lifecycle are enforced by ui-sidebar-right.

<a id="dev-note"></a>
### Dev Note

Do not register a second conversation.session.header.corner contributor; extend the existing ExpandButton owner when adding a top-right tool.
