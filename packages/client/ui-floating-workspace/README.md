---
description: "Open independent side-chat tabs or a small in-app auxiliary conversation panel."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-floating-workspace

English | [中文](README.zh.md)

## Summary

Floating Workspace opens the conversation as an in-app chat panel: floating over the column, or docked as a right-Sidebar tab. Its Settings page controls enablement, entry position, and the floating panel's size.

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


The settings page contributes its split-panel navigation icon through the settings icon slot.

Open Settings → Personal → Floating Workspace and enable the feature. Enabling adds an entry without opening anything. The conversation-header entry creates a new independent Side chat tab in the right Sidebar. Each tab owns its own auxiliary Session; the tab strip can switch between chats, create another tab, or close one. The floating entry and registered shortcut still toggle the separate small floating panel. Turning the feature off closes that panel. Preferences live in the Host's `ui-floating-workspace` namespace, which is this row's Loader entry id, through the normal revisioned settings writer.

| Preference | Default | Consumption |
| --- | --- | --- |
| Enable Floating Workspace | Off | Shows the entry and enables the command; disabling closes the panel. |
| Entry position | Conversation header | The header creates a Side chat tab; the floating button toggles the small panel. |
| Panel width | 400 px | Floating panel width, an integer from 200 to 800 pixels. |
| Panel height | 560 px | Floating panel height, an integer from 280 to 800 pixels, capped to the viewport with 24 px margins (12 px on narrow screens). |

The settings page presents one card with enablement and entry position; neither surface starts a terminal, so the card carries no directory row. Side chat tabs and the floating panel use independent auxiliary Sessions. Each inherits the main Session's working directory when one exists, but never replaces or follows the main selection. Creation failure stays visible and can be retried. The default command is Ctrl + Shift + Space, and the Keyboard shortcuts page owns overrides and conflict reporting. Browsers constrain the panel to the viewport.

Both surfaces render the Conversation's embedded occurrence: the `conversation.content` Component Factory with `variant: 'embedded'` and a chat-only `views` selection. The floating panel registers in the frame overlay and keeps one auxiliary SessionReference for its lifetime. Side chat tabs register a `multiple` right-Sidebar page kind; each occurrence creates and retains its own auxiliary SessionReference, and releases it when the tab closes or unmounts. No surface follows or replaces the main Conversation Session.

The optional `floatingTerminalConsumer` service stays wired for a real terminal consumer, but nothing on this surface edits a directory.

### Composition and configuration

The Host entry registers the preference schema through `Config`, derived as the volatile form of `FloatingWorkspaceSettingsSchema`, so the settings document publishes the namespace. The Client consumes settings, locale, slots, keyboard, and Sessions; it registers its page under section id `floating-workspace` in group `personal`. An optional `floatingTerminalConsumer` service enables directory editing only for the lifetime of the real terminal consumer. The shared `floatingWorkspaceContext` callback publishes JSON data from [sidebar terminal types](../../terminal/sidebar-terminals/src/types.ts); no UI implementation crosses package imports.

| Deployment configuration | Default | Meaning |
| --- | --- | --- |
This package has no deployment configuration: the panel needs no tunable, and the former window-observation cadence disappeared with the separate app window.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[Registration](src/client/index.ts) owns dictionaries, searchable metadata, the command, the right-Sidebar tab type, and contributions to existing settings, header, sidebar, and overlay slots. Settings metadata follows the settings slot declaration's lifetime. Components receive framework-bound observable facts and plain callbacks. The floating entry delegates keyboard matching to the keyboard service.

[The runtime](src/client/runtime.ts) owns the panel's open state and the accepted settings snapshot. Writes use the canonical settings mutation operation and confirm both effective and raw accepted fields. Refused writes preserve the accepted values. Disabling the feature and disposal close the panel; disposal removes the settings subscription and awaits pending preference mutations.

[The chat occurrence](src/client/FloatingChat.tsx) renders `renderFactorySlot('conversation.content', …)` with `variant: 'embedded'` and a chat-only `views` component. [The floating panel](src/client/FloatingPanel.tsx) registers in the frame overlay and sizes itself from the accepted width and height preferences; [the side-chat tab](src/client/FloatingTab.tsx) creates its own auxiliary Session before rendering the occurrence.

No runtime invariant companion is published: its accepted settings and panel state have one owner. Loader persistence tests, registration disposal tests, and panel open/close tests cover those relationships.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These references own the surrounding settings, keyboard, window, and terminal behavior.

- [Settings domain](../ui-settings/README.md) — revisioned writes and section metadata.
- [Keyboard service](../keyboard/README.md) — registered commands, overrides, and event matching.
- [Sidebar terminal types](../../terminal/sidebar-terminals/src/types.ts) — immediate window identity and captured new-terminal directory data.
- [Client slots](../../../docs/subsystems/slots.md) — declarations, framework hooks, and registration lifetimes.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package registers no model-facing prompts or tools and writes no Session events.

#### KV Cache effect

None; this package does not assemble or send provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The Host catalog retains closed auxiliary Sessions until the normal Session deletion workflow removes them; the right-Sidebar tab layout follows the existing per-main-Session persistence rules. This package supplies no terminal implementation, automatic window restore, or separate app shell.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
