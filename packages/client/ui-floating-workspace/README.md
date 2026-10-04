---
description: "Open an owned app window with persisted entry, size, and new-terminal directory preferences."
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

Open Settings → Personal → Floating Workspace and enable the feature. Enabling adds an entry without opening anything. The conversation-header entry opens the docked Sidebar tab, whose own tab control closes it; the floating entry — and the registered shortcut — toggles the panel. Turning the feature off closes the panel. Preferences live in the Host's `ui-floating-workspace` namespace, which is this row's Loader entry id, through the normal revisioned settings writer.

| Preference | Default | Consumption |
| --- | --- | --- |
| Enable Floating Workspace | Off | Shows the entry and enables the command; disabling closes the panel. |
| Entry position | Conversation header | The conversation header opens the docked Sidebar tab; the floating button opens the panel. |
| Panel width | 400 px | Floating panel width, an integer from 200 to 800 pixels. |
| Panel height | 300 px | Floating panel maximum height, an integer from 150 to 600 pixels. |

The settings page presents one card with enablement and entry position; the panel starts no terminal, so the card carries no directory row. The header entry appears only when a Session header exists; the shortcut also works from the app's empty-session view. The default command is Ctrl + Shift + Space, and the Keyboard shortcuts page owns overrides and conflict reporting. Browsers constrain the panel to the viewport.

Both surfaces render the Conversation's embedded occurrence: the `conversation.content` Component Factory with `variant: 'embedded'` and a chat-only `views` selection. The panel therefore holds the transcript, its tool cards, and the composer, and no main Conversation header. The floating panel registers inside the Conversation's Session area, which supplies the Session binding and the Conversation provide, and positions itself over the column with its own CSS. The docked form is a right-Sidebar page kind whose body renders the same occurrence. Opening either surface creates no Session and submits no input.

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

[The chat occurrence](src/client/FloatingChat.tsx) renders `renderFactorySlot('conversation.content', …)` with `variant: 'embedded'` and a chat-only `views` component. [The floating panel](src/client/FloatingPanel.tsx) registers in the Conversation's Session area and sizes itself from the accepted width and height preferences; [the docked tab](src/client/FloatingTab.tsx) renders the same occurrence for the right-Sidebar page kind.

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

- The operating environment controls popup availability and final window bounds. A browser without the required UUID capability reports the feature unavailable. The conversation-header seat is absent in the empty-session view. The directory field and picker remain disabled without the real terminal consumer; picker failures retain typed input, and a directory outside the selected Session's working tree is rejected by the terminal Host. This package supplies no terminal implementation, automatic window restore, or separate app shell.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
