---
description: "Open the official Schedule task manager from Settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-automation

English | [中文](README.zh.md)

## Summary

Provide a Settings entry point to the official Schedule task manager. The page opens the same catalog and task detail surface used by the Schedule sidebar and Session views; it does not create a second task store or execution runtime.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount the browser entry beside Settings, Locale, and Layout. The package registers only a Settings launcher; the official `ui-schedule` entry owns the Schedule catalog, task detail view, and remote mutations.

A new draft requires a title, prompt, workspace, agent preset, model, permission preset, and hourly, daily, or weekly UTC schedule. Weekly days use Sunday = 0. Optional reasoning effort is an explicit provider-owned value, not an invented list of supported choices. Failed saves preserve the draft and its original revision; discard and reopen Edit to adopt a newer task revision after a conflict.

Enable and Pause change scheduling explicitly. Run once works while the task is disabled and does not enable it. Retry same request retains its admission token after an uncertain response; another deliberate Run once creates a new token. Pause does not cancel active work. Cancel run sends cancellation for the recorded invocation. Delete requires confirmation and an inactive task.

The journal loads real pages for the selected task. Starting, running, stopping, completed, failed, cancelled, skipped-overlap, interrupted, and ambiguous states come from recorded evidence. A completed turn does not establish business success. Interrupted or uncertain outcomes show a review warning, never an automatic retry. Open Session is available only when the run records a Session id. Read-only and unavailable connections disable mutations without replacing cached data with an empty list.

This page adds no tools, system instructions, or Session events. Opening or editing it invokes no model; explicit execution consumes the model resources used by the resulting Session.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Slots renderer binds the API Client's stable source to the useAutomation hook. Components receive only framework props and plain callbacks. Definitions, active runs, catalog choices, and journal pages remain in the API object; component state contains only drafts, confirmation, pending feedback, and manual request tokens. The page and its static localized search metadata share one Settings declaration lifetime and dispose together. Search metadata never contains prompts, workspace paths, task titles, or journal values.

No runtime invariant companion is published: the page owns no independent business-state projection. Component tests check presentation and callback arguments; the Loader test exercises the real API Client source, renderer binding, and registration disposal.

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Web Client architecture](../../../docs/subsystems/web-client.md) — business data and rendering ownership.
- [Slots reference](../../../docs/subsystems/slots.md) — source hooks and registration lifetimes.
- [Schedule package](../../schedule/schedule/README.md) — durable task rules and delivery semantics.
- [Schedule client](../ui-schedule/package.json) — the official task manager opened by this entry.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Package-local tests use deterministic Host replies and never start a model or external server. Assembled browser validation belongs to the parent composition owner.

</details>

<a id="model-experience"></a>
## Model Experience

This page invokes no model and owns no Schedule data. The official Schedule service and task manager own reminder delivery and model-visible operations.

#### KV Cache effect

This page does not assemble provider requests or alter their prefixes; the automation runtime and selected Agent composition own request construction and its cache effects.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Creation starts from the official Schedule task manager or the `schedule_create` tool; this Settings entry only opens that manager.
- The page and the task manager share the Host Schedule catalog and delivery history.
- Task creation, recurrence validation, Session targeting, and delivery are owned by the Schedule package.
