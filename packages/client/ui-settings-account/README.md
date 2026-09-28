---
description: "Cinlan Account Settings UI for one account sign-in, authorization prompts, and explicit local sign-out."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-account

English | [中文](README.zh.md)

## Summary

This browser plugin adds a Cinlan Account section to Settings. It shows the fixed Cinlan account sign-in state, starts the account/password flow, renders caller-owned notices and prompts, masks secret answers, and removes the local account credential only after an explicit non-revocation warning. Provider and model configuration stays outside this section.

## Table of Contents

- [Use Accounts settings](#use-accounts-settings)
- [State and composition](#state-and-composition)
- [Security](#security)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-accounts-settings"></a>
## Use Accounts settings

Open Settings, then Cinlan account. The page shows one account card with its local connection state and a single sign-in action. Account login uses the Cinlan email and password; if the service requests two-factor verification, a masked code prompt appears. Progress notices, HTTP(S) continuation links, codes, text inputs, and masked secret inputs remain in the same feature-owned section.

A connected card can start the sign-in flow again or sign out on this computer. Sign-out removes only the local account credential and does not revoke access on the Cinlan service. The success notice repeats that limitation.

<a id="state-and-composition"></a>
## State and composition

The apply body owns one `AccountSettingsSource`. It restarts the secret-free snapshot stream on each usable Connection generation and cancels its active authorization stream when the connection changes or the plugin leaves. Disposal waits for those cancellable streams but not for connection-owned unary commands; a unary result from an earlier Connection generation is contained and cannot update reconnected or disposed UI state. Complete Remote snapshots reach React through the injected `useAccount` hook; they do not enter a Settings interaction store.

The plugin registers the `account` section and its metadata through `ctx.slots.inject('settings.section', ...)`, plus a keyed user icon through `settings.section.icon`. All registrations and Remote lifetimes leave with the plugin fiber. The shipped web bundle mounts this browser row, while the base bundle mounts the Host account controller.

<a id="security"></a>
## Security

Prompt metadata may enter the observable source, but answers do not. The prompt component keeps its current value in local React state, uses a password input for `secret`, clears the value when submitting, and passes it directly to the one-way `answer` command. No answer, credential record payload, password, token, or API key enters a Remote snapshot, feature store, injected props field, or log.

The Host admits only HTTP(S) notice links without URL credentials. The component applies the same check before rendering an anchor. UI failures use fixed locale keys rather than upstream exception messages. English and Simplified Chinese copy is owned by typed dictionaries.

No invariant companion is published because the section renders the controller's current views and keeps no second durable account model.

<a id="further-exploration"></a>
## Further Exploration

- [Web Client subsystem](../../../docs/subsystems/web-client.md) — client loading, object sources, and presentation composition.
- [Account controller](../../api/account-controller/README.md) — Remote methods, failure classes, and security projections.
- [Slots subsystem](../../../docs/subsystems/slots.md) — section registration and injected hook binding.

<a id="model-experience"></a>
## Model Experience

None. This Settings section does not create messages, tools, system-prompt text, or other model-visible content.

#### KV Cache effect

No invalidation; the UI contributes no request-prefix content.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Signing out removes the local Cinlan credential but does not revoke remote account access or confirm its remote status.
- The section requires the fixed Cinlan authorization flow; it does not discover orphan records left by an uninstalled provider.
- Reloading or losing the Connection cancels an active attempt. Attempts are not resumable.
