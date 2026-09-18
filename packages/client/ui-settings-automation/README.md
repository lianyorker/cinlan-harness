---
description: "Create disabled automation drafts, explicitly control execution, and inspect UTC run evidence in Settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-automation

English | [中文](README.zh.md)

## Summary

Manage recurring tasks from Settings → Experimental → Automation. Create a disabled draft, choose existing resources, and explicitly enable its schedule or run it once. Inspect recorded runs and open their Sessions to verify the actual task result. All displayed schedule and journal times use UTC.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount the browser entry beside Settings, Locale, Session navigation, and the Automation API Client. The package accepts no configuration fields; its Node entry registers no services. The composition supplies the runtime and controller separately.

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
- [API declarations](../../api/automation-controller/src/types.ts) — actual resource choices and journal pages.
- [Runtime declarations](../../automation/automation/src/types.ts) — recurrence, admission, and execution evidence.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Package-local tests use deterministic Host replies and never start a model or external server. Assembled browser validation belongs to the parent composition owner.

</details>

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [automation runtime](../../automation/automation/README.md), which owns execution of the saved prompt and resource selections requested by this page.

#### KV Cache effect

This page does not assemble provider requests or alter their prefixes; the automation runtime and selected Agent composition own request construction and its cache effects.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Schedules use UTC only. There are no queue, notification, retention, or remote-routing controls.
- Drafts and uncertain manual request tokens are local to the mounted page; leaving Settings discards that viewing state.
- Journal browsing selects one task. A deleted task's already-open journal remains inspectable; this page does not provide a separate deleted-task directory.
- Supported reasoning effort values are validated by the runtime; the page does not claim a provider-independent effort list.
