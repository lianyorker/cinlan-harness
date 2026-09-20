---
description: "Submit message ratings and conversation feedback through a dialog with categories, context disclosure, and retryable drafts."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-message-feedback

English | [中文](README.zh.md)

## Summary

Submit feedback about a completed answer or the whole conversation. Like and Dislike open a dialog with seven optional categories and a detail field; a bare `/feedback` opens the same form for the Session. The dialog discloses that submission includes the current conversation log. Feedback stays outside model context, and failed submissions keep the draft available for correction.

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

Mount this plugin alongside `ui-conversation` and `ui-commands`. Either unrecorded rating opens the feedback dialog; Submit records the judgment with the optional category and description. Closing the dialog discards the draft without recording. Clicking an already recorded rating retracts it. The composer menu and bare `/feedback` open the Session form, while `/feedback <text>` retains the Host command and its acknowledgement row.

### Failures

A list-load or retraction failure appears beside the rating buttons. A submission failure shows a warning toast and keeps the dialog draft open. A conflict updates the recorded rating from the Host reply, while the draft remains available for retry. Only finalized messages receive feedback controls.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One message controller and one dialog controller serve each Session. The message controller defers its first read until interaction, serializes mutations, and uses Host versions for compare-and-set updates. The dialog routes a message judgment through `messageFeedback` and a Session remark through `sessionFeedback`. A late successful submission acknowledges the saved feedback without closing a newer draft; disposal prevents later notifications. Slot entries and the bare-command decoration share the plugin lifetime.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the feedback surface is not enough. They move from the browser strip to the Session-log backend and the conversation shell.

- [dsh-message-feedback](../../feedback/message-feedback/README.md) — the Session-log backend that owns per-item compare-and-set and persistence.
- [ui-conversation](../ui-conversation/README.md) — declares the assistant-actions strip and renders the action row.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

None, as ratings and notes are log-only events, not model input. Optional Session-log delivery uses request metadata rather than model context.

#### KV Cache effect

None; feedback mutations leave the model-visible history unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current feedback surface. They are current package constraints, not a general rating comparison or a task backlog.

- **Note size is a Host policy** — the deployment configures `maxNoteBytes` (8192 in the Web bundle) and the Host rejects an oversized note with `note-too-large`. The dialog does not pre-check the limit, so an oversized message description fails on submit while preserving the draft. Session remarks have no size bound.
- **No cross-tab push** — a second tab's rating becomes visible on reconnect or on the next conflict reply, not immediately; the controller does not consume feedback log events.
- **Chat view only** — the trajectory and waterfall views render no feedback controls even though their assistant nodes carry the same `messageId`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Slot registrations, command decoration, and per-session controllers share the plugin lifetime; lifecycle tests observe their removal and reject late publication.
