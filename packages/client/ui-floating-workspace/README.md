---
description: "Open an owned app window with persisted entry, size, and new-terminal directory preferences."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-floating-workspace

English | [中文](README.zh.md)

## Summary

Floating Workspace opens the existing application in a separate window while the main window remains available. Settings control its entry position and the requested size of the next window. An installed terminal consumer also uses the saved directory when creating a new floating terminal; an absent consumer leaves that field visibly unavailable.

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

Open Settings → Personal → Floating Workspace and enable the feature. Enabling adds an entry without opening a window. Use that entry, the settings page's Open action, or the registered shortcut to open and close one workspace window. Turning the feature off closes its owned window. Existing preferences remain in the Host's `floating-workspace` namespace through the normal revisioned settings writer.

| Preference | Default | Consumption |
| --- | --- | --- |
| Enable Floating Workspace | Off | Shows the entry and enables the command; disabling closes the owned window. |
| Entry position | Conversation header | Chooses the conversation header, sidebar footer, or floating button. |
| Window width | 400 px | Requests 200–800 integer pixels for the next window. |
| Window height | 300 px | Requests 150–600 integer pixels for the next window. |
| Terminal starting directory | Empty | New floating terminals inherit their associated Session directory when empty; a configured existing directory must resolve to that directory or a descendant. |

The header entry appears only when a Session header exists. The settings Open action and shortcut also work from the app's empty-session view. The default command is Ctrl + Shift + Space; the Keyboard shortcuts page owns overrides and conflict reporting. Changes to size affect future windows. Browsers and operating systems may constrain actual dimensions.

The child loads the same app artifact and normal layout, conversation, workspace, and terminal slots. Its Close workspace window control stays in the sidebar footer in both expanded and compact layouts. It initially selects the source Session if that Session is in the accepted catalog, then retains normal navigation. If the Session is missing, the child explains that another Session can be selected. It creates no Session and submits no conversation input merely by opening.

Directory editing is available only while the actual terminal renderer provides its consumption marker. Each new floating UI terminal captures its window identity and the accepted directory. The terminal Host validates existing-directory containment, including symlinks, before spawning. Running terminals and main-window or Agent terminal directories are unaffected. Loading or unavailable preferences withhold new-terminal readiness while retaining the floating window identity for isolated layout.

A blocked Web popup produces an explicit retry message below the header while the configured entry remains available to retry. An unsupported environment or refused native app-window request reports unavailability. Closing restores the still-connected originating control when its source window remains alive. Open windows are not persisted or reopened automatically.

### Composition and configuration

The Host entry registers the existing five-field schema. The Client consumes settings, locale, slots, keyboard, and Sessions; it registers its page under section id `floating-workspace` in group `personal`. An optional `floatingTerminalConsumer` service enables directory editing only for the lifetime of the real terminal consumer. The shared `floatingWorkspaceContext` callback publishes JSON data from [sidebar terminal types](../../terminal/sidebar-terminals/src/types.ts); no UI implementation crosses package imports.

| Deployment configuration | Default | Meaning |
| --- | --- | --- |
| `windowClosedPollMs` | 500 | Check the exact owned WindowProxy for external closure, from 100 to 5000 ms; the timer exists only while a window is owned. |

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[Registration](src/client/index.ts) owns dictionaries, searchable metadata, the command, and contributions to existing settings, header, sidebar, and overlay slots. Settings metadata follows the settings slot declaration's lifetime. Components receive framework-bound observable facts and plain callbacks. The overlay delegates keyboard matching to the keyboard service and installs no command listener in a child window.

[The runtime](src/client/runtime.ts) retains one exact window handle and the accepted settings snapshot. Writes use the canonical settings mutation operation and confirm both effective and raw accepted fields. Refused writes preserve the accepted values. Disable, page exit, and disposal close the owned child; disposal removes observations and awaits pending preference mutations. A validated child exposes its window identity before settings are ready, so the terminal consumer can choose its isolated store before creating layout state.

[The browser adapter](src/client/window-environment.ts) opens synchronously from the user gesture. Its URL contains only the floating marker, a validated window UUID, and an optional nonsecret Session id. Credentials, unrelated query parameters, and hashes are removed. It uses the normal app origin and authentication carrier. [The Desktop policy](../../../apps/desktop/src/floating-window.ts) admits only the exact `dsh-app://app/index.html` floating route from the main app, fixes trusted preload and security options, denies child popups and other navigation, and destroys its exact child on owner or Host replacement.

No runtime invariant companion is published: its accepted settings and window handle have one owner, and external closure is an observed lifecycle event rather than a second authoritative registry. Loader persistence tests, registration disposal tests, and window-lifecycle tests cover those relationships.

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

The operating environment controls popup availability and final window bounds. A browser without the required UUID capability reports the feature unavailable. The conversation-header seat is absent in the empty-session view. The directory field remains disabled without the real terminal consumer, and a directory outside the selected Session's working tree is rejected by the terminal Host. This package supplies no directory picker, terminal implementation, automatic window restore, or separate app shell.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
