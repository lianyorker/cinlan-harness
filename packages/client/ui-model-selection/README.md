---
description: "Session model selection and new-session defaults for the Web GUI, using one shared provider-grouped catalog; for users and maintainers of model routing."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-model-selection

English | [中文](README.zh.md)

## Summary

The Web GUI lets users switch the model and reasoning effort for an existing session through either the `/model` popup or the composer's model control. Both surfaces present the same provider-grouped choices, and the selected model determines the available effort names and default. A complete selection applies to the next request; a running step keeps the model and effort it started with. If no adapter can serve the session's route, the composer remains disabled until routing becomes available. The plugin also contributes new-session defaults to the Models settings page.

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

Mount this plugin alongside `ui-conversation` and the commands package; the composer then shows the model seat next to the pending indicator, and `/model` opens the same directory as a popup. Both surfaces show the host-reported current selection when the exact provider/model pair remains in the advertised groups; a missing catalog row leaves the routable selection intact while the trigger prompts `Select model`.

### Model and effort

Models stay grouped by provider. The menu shows model and effort names only; catalog descriptions remain available to other consumers. The `/model` popup applies the selected model's default effort; the composer can then choose any advertised effort. An adapter without reasoning metadata leaves the Effort row absent; there is no arbitrary effort input.

<a id="new-session-defaults"></a>
### New-session defaults

Settings → Models exposes Default model and Reasoning effort when the settings services are present. Choices save automatically to the `agent-default-model` namespace for future sessions. Changing the model writes provider and model together and clears the previous route’s effort override; Reset to inherited unsets all three fields, including overrides equal to inherited values. Changes here do not overwrite existing session selections. Switching the model inside a session also saves future defaults.

Unavailable or read-only settings disable the controls. Only the selected route’s advertised reasoning efforts are offered. Rejected writes remain unsaved; a conflict displays the recovered Host values, and Retry save reapplies the intended choice using their revision.

When another DSH instance holds the Session writer, both the composer selector and `/model` show localized guidance to quit other running instances and retry. Other selection failures retain their diagnostic code and message.

### Unroutable sessions

When the Host reports that no adapter serves the session's route, this plugin raises a composer block and the input goes inert with its own copy; recovering clears it without a reload. A `null` before the first load or after one failed never blocks, and catalog membership never blocks either — a route serving a model it does not advertise is missing from the groups yet usable.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`ModelDirectoryResolver` (`ctx.modelDirectories`) owns one Host-generation `ModelCatalogDirectory` and lazy per-session `ModelDirectory` projections. The `/model` popup and composer seat submit through `session.selectModel` and share each Session’s directory; addressed subagent sessions expose neither selector. Forwarded adapter, settings, and credential invalidations refresh the shared catalog.

`ModelDirectory.select()` returns the operation’s `RemoteResult<void>` so each selector can present its own failure even if a later catalog update changes the shared directory error.

The defaults contribution binds `agent-default-model` through SettingsScope and exposes that scope and the same catalog through renderer hooks. Atomic mutations use the scope’s revision fencing, queue, and recovery reads. Save confirmation compares all three raw user-layer fields, including own-field presence for unset operations; a settled promise or matching effective value alone cannot announce success. The controls and localized search entries share the optional `settings.models.defaults` slot lifetime.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the model surface is not enough. They move from the browser surfaces to the command popup shell and the selection contract.

- [ui-commands](../ui-commands/README.md) — the popupSelect shell the `/model` contribution registers into.
- [ui-conversation](../ui-conversation/README.md) — declares the composer's `conversation.input.model` seat and the composer block.
- [dsh-agent-default-model](../../core/agent-default-model/README.md) — the default-model service for sessions that never choose.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through session selectors that submit through `session.selectModel` and Settings controls that change the model and effort inherited by future sessions; the Host snapshots the complete `ModelSelection` at the next prompt-assembly boundary, while a running step keeps its assembled selection.

#### KV Cache effect

Switching the route can reduce or invalidate provider-side cache reuse for subsequent requests; the prompt prefix itself is untouched.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current model surface. They are current package constraints, not a general model-router comparison or a task backlog.

- **No per-draft or addressed-subagent selection** — Settings edits shared future defaults; the per-session selectors require an existing ordinary session’s Agent, and subagent continuation exposes no independent model-selection operation.
- **Directory names are presentation-only** — selection and persistence use provider/model/effort ids; a provider whose catalog or exact-model metadata lookup fails lists as an unselectable failure row until reload.
- **No arbitrary effort input** — the composer offers only the exact model's adapter-advertised levels; an adapter without reasoning metadata leaves the Effort row absent.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The settings scope and shared catalog own persisted defaults and advertised choices; the controls hold only transient save feedback. Behavior tests cover write confirmation and contribution disposal.
