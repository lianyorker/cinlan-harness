---
description: "The two Subagent settings pages under Settings → Agents: the **Limits** page holds delegation depth and capacity over the subagent namespace, and the **Subagents** page holds the models agents may choose over subagent-model-selection."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-subagent

English | [中文](README.zh.md)

## Summary

Open Settings → **Agents** to set how deep and how wide delegation may go (the **Limits** page), and which models agents may choose for their subagents (the **Subagents** page). Each page follows its own namespace: the **Limits** page exists while the Host serves `subagent`, and the **Subagents** page while it serves `subagent-model-selection`.

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

**Limits** holds **Maximum recursion depth** and **Subagent parallelism limit** side by side, stacking on narrow screens; the information button beside each label discloses its rule — a two-row depth example, and the count that capacity bounds — and a draft that is not a whole number in range blocks the save and says so under the field. Depth yields to a tool's own maximum; capacity counts every live subagent under one main agent across all levels, the main agent excluded.

**Model selection** stages its permission switch and the exact adapter routes together. Enabling requires at least one selected route; disabling keeps the selected routes for later. Routes the Host stored but no adapter advertises stay listed under **Saved but currently unavailable** and remain removable; a provider that failed to load is reported without hiding the others, and a failed load offers **Retry**.

Each page's **Save** writes its own draft, fenced by the revision the draft read. A draft the Host refuses keeps its staged state with the failure reported, and a model draft a newer Host revision superseded is reported as a conflict to discard rather than overwriting the newer routes. Leaving a page drops that page's draft.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for. The browser half binds each namespace through `ctx.configForms.get`: `SubagentLimitsCardController` stages the limits over the shared `SettingsFormModel` of `ui-primitives`, with a field spec that admits safe whole numbers at or above each field's floor; `SubagentModelSelectionCardController` keeps its own draft because its two fields save as one revision-fenced `mutate`, joins the stored routes with `remote.session.modelCatalog()`, and re-reads the catalogue on `llm/adapters-updated` and `settings/document-updated` while a connection reset drops its draft. `SubagentLimitsSection` and `SubagentModelSelectionSection` render one page each inside the shared `SettingsForm`, and each page registers into the Settings section slot through `ctx.configForms.whileServed` over its own namespace.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-settings-general](../ui-settings-general/README.md) — the full-page Settings shell and Agents navigation group.
- [ui-settings](../ui-settings/README.md) — the settings scope and the served-namespace watch the page rides.
- [ui-primitives](../ui-primitives/README.md) — the settings form model and fields the limits section renders.
- [tool-subagent](../../subagent/tool-subagent/README.md) — the delegation tools that register both namespaces.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The catalogue re-reads on three signals only** — adapter changes, document commits, and reconnects; a provider that starts advertising without any of them shows up on the next of those or on **Retry**.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
