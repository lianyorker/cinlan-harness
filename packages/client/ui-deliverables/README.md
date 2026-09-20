---
description: "Turn-scoped changed-file cards, per-file comparisons, and clickable output references in the Web client."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-deliverables

English | [中文](README.zh.md)

## Summary

Review the files a completed turn changed and inspect each file’s recorded before-and-after comparison. Cards show line counts and open a review tab in better-sidebar when installed, or in sidebar-right. Explicit `present` declarations add delivery cards for current source files, including shell-created files. Existing produced-file rows and inline-code links continue to open files. Binary files, oversized captures, and expired records display explicit states.

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

The completed-turn changes card lists the files recorded by [workspace-changes](../../deliverables/workspace-changes/README.md). Its header opens the first comparison; a file row opens that file’s original summary index. Cards fold after three files. The review supports file selection, unified or split lines, wrapping, and opening the whole file through the sidebar’s existing navigation.

Delivery cards replay `deliverables/presented` without requiring mutation calls. The card body previews through better-sidebar with the viewed Session ID and known cwd; the menu opens the default application or reveals the source in the Host file manager. `GET /api/present.host` supplies Host capabilities. `POST /api/present.open` accepts only Session/event/file coordinates and an action; it resolves the persisted declaration and captures one execution lease through validation and native launch. Remote leases return unsupported before Host file access. Local leases reject non-files and final symbolic links through their filesystem, and verify that the provider and Host refer to the same file before launch. Reading a declaration never activates an Agent. Edits change what opens; moving or deleting the source makes it unavailable. No preserved copy is stored.

Mount workspace-changes with this plugin. The Host registers authenticated `GET /api/changes.summary` and `GET /api/changes.diff` routes through Connection Fetch. Requests identify a Session, announcing event sequence, and original file index; they never choose a Host path. Summaries omit cwd and private snapshot ids.

An installed better-sidebar receives review opens through its public tab and file-navigation API. The fallback registers a `sidebar.right.pane.tab` body and tab definition. New cards use the additive `conversation.chat.turnCards` list; the existing `conversation.chat.turnTail` chain and produced-file row retain their behavior. Settings styling and Desktop transport stay owned by their existing packages.

Comparison contents last until Host restart or Session disposal. Retained events alone cannot reconstruct an expired diff. Missing summaries hide their cards; an open review distinguishes missing records from retryable read errors. Binary or oversized captures have no text diff, and displays above 10,000 lines show a truncation message.

### Existing produced-file row and mentions

The produced-file row and closing-prose mentions keep their exact-path or unique-basename vocabulary. They use the original `conversation.chat.turnTail` chain and remain independent of the changed-files card.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser half correlates `workspace/changes` announcements by turn, including announcements appended after the closing message. Host routes serve only validated Session, event-sequence, and file-index coordinates; they do not accept a requested filesystem path, and summary responses omit cwd and private snapshot ids.

The optional better-sidebar integration calls only its public tab and file-navigation methods. The fallback registers a `sidebar.right.pane.tab` body and tab definition. Selection changes cancel outstanding reads, plugin disposal waits for owned requests, and comparison rendering retains at most 10,000 lines.

Runtime invariant: none. This package validates Host responses and derives cards from conversation data; it owns no independent runtime relationship that can diverge.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages for the recorder, chat-card composition, and sidebar navigation.

- [Workspace changes](../../deliverables/workspace-changes/README.md) — capture limits, comparison service, and live-Session lifetime.
- [ui-conversation](../ui-conversation/README.md) — chat turn-card and tail rendering.
- [Right sidebar](../ui-sidebar-right/README.md) — fallback tab navigation.
- [Better-sidebar extension API](../ui-better-sidebar/AGENTS.md) — optional tab registration.

-----

<a id="model-experience"></a>
## Model Experience

### Clickable file-reference guidance

#### What the model sees

One fixed paragraph instructs the model to name primary files from successful creation or modification calls in its final response and to format those and any other changed-file references as exact-path or unique-basename Markdown inline code, such as `out/report.html`.

#### Token effect

One fixed prompt paragraph whenever this package is loaded; no tool schema, tool result, or per-turn context is added.

#### KV Cache effect

The section is static at first-party order 9000 for the lifetime of the package mount, so it remains in the reusable prompt prefix and does not change across turns.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the current changed-files card and comparison service:

- **Comparison contents remain in the live Host Session** — a Host restart or Session disposal leaves the event but cannot reconstruct the diff.
- **Missing data does not trigger path guesses** — an unavailable summary hides the card, while an open review distinguishes missing records from retryable read errors.
- **Binary and oversized captures have no text comparison** — displays above 10,000 lines show a truncation message.
- **Inline mentions use exact paths or unique basenames** — produced and explicitly delivered paths share the existing matching rules.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This implementation selectively adapts official `b784e586ef` (turn changes) and `8225e18d70` (per-file review), while retaining recorder fixes `2440937459`, `974d0271c0`, and `4233590de6` for bounded captures, Windows behavior, and Git configuration isolation. It uses local sidebar APIs without importing Session references or replacing the slot system, and it does not change Settings styling.

</details>

**Runtime invariant:** No runtime invariant companion is published because the UI derives cards from recorded events and source-file reads without independently owned durable state. Prompt, slot, dictionary, event-definition, and optional-service registrations are effect-owned and disposed by the plugin lifecycle.
