---
description: "Slash commands for the Web GUI: client actions and popup selectors, host command inputs, and session-specific command discovery."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-commands

English | [中文](README.zh.md)

## Summary

Typing a `/` command in the composer opens a picker, runs a client action, or submits a host command. Business packages can add client commands or decorate a host command’s bare invocation while its text arguments still reach the host. Command lookup uses the current session’s catalog, and lookup failures never silently turn a command into a plain prompt.

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

Mount this plugin alongside `ui-input-trigger` and `ui-conversation`; the `/` source then appears in the trigger menu, and business packages register their command surfaces through `ctx.commandUi`. Typing `/model` opens the registered popup; a host command with an argument claim opens its input or executes directly.

### Kinds and decorations

A contribution is a client-owned command; a host-name collision fails loud. A decoration adds a bare-invocation popup or action to an existing host command. The host retains its catalog row, argument claim, and lifecycle logging for executed commands; a decoration with no host row never fires. Menu queries fuzzy-match ordered, case-insensitive subsequences of command names; prefixes rank first.

### Attachment-carrying submissions

An `action` requests guarded token consumption, then runs its synchronous callback with the invoking session. It submits nothing and leaves attachments in the composer, even when the token guard misses. Other attachment-carrying submissions require a host command declaring `input.attachments`; popup routes and non-accepting host commands throw the localized `attachmentsUnsupported` refusal, preserving the draft and attachment cards. Handler errors preserve the same draft state for retry.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/client/contract.ts`](src/client/contract.ts) defines contribution and decoration registration through `ctx.commandUi`. A bare menu pick or Enter invokes the registered `popupSelect` or `action`; Space and Enter with arguments retain the host input claim. Actions request token consumption before running: menu picks use the captured span and draft revision, while bare Enter checks that the trimmed draft still equals the token. The input owner enforces both guards. `CommandDirectory` caches each session’s host catalog, invalidates it on host changes and connection resets, and rejects stale fetch results. After a matched host execution, the browser emits a local `command/executed` acknowledgment; other clients receive durable command nodes. `PopupSelectController` owns picker state, and `PopupSelectView` renders through `conversation.input.overlay`. `ctx.commandUi.dismiss(name)` closes matching popups and confirmations, aborts pending option loads, and restores composer focus without consuming drafts.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the command surface is not enough. They move from the command API to the trigger pipeline and the host command registry.

- [ui-input-trigger](../ui-input-trigger/README.md) — the pipeline the `/` source registers into.
- [ui-conversation](../ui-conversation/README.md) — declares the input overlay slot and owns the composer.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the host `command.execute` RPC the dispatch paths trigger: each command handler's host package owns any model-visible effect (the `/plan` handler flips plan mode, whose owning package injects its policy section), while the command line, the detached result, and every menu and notice rendering stay client-side and never enter the session log.

#### KV Cache effect

None directly; this package neither assembles nor sends a provider request. Command handlers it triggers may change what the owning host packages contribute to the next request's system prompt — a section appearing or disappearing replaces earlier request tokens and invalidates the provider prefix from that point — but that effect is owned and documented by each command's host package.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current command surface. They are current package constraints, not a general command-line comparison or a task backlog.

- **Detached-result notices fall back to the console off-session** — the fire-and-forget paths route results to the triggering session's composer via `SessionInput.notify`; after session teardown the console line is the only remaining surface.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. A browser-side source over the wire command directory — it emits no cordis events and owns no cross-plugin mutable state; dispatch and cache behavior are asserted by this package's specs.
