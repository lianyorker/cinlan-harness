---
description: "The parallel tool-call cap of the agent-loop namespace, as a live row in the General settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-agent-loop

English | [中文](README.zh.md)

## Summary

Open Settings → **General** to set how many parallel-safe tool calls one step may run at once. The row is a live number input: every accepted whole number writes through at once, and an overridden value carries **Reset to default** beside it. The row exists while the Host serves the `agent-loop` namespace.

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

The **Parallel tool calls** row in General bounds the calls the loop runs at once within one step. The input applies immediately: every whole number of at least 1 typed into it writes through, an invalid draft writes nothing and blurs back to the effective value, and blanking an override blurs as a reset to the deployment default. An overridden value carries **Reset to default** beside it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for. The browser half binds the `agent-loop` namespace through `ctx.configForms.get`; `AgentLoopCardController` mirrors the shared configuration form's effective value, override state, and writability directly, and writes go through the form's `set`/`unset`. `AgentLoopCard` registers into the General settings' item slot through `ctx.configForms.whileServed`. The row's copy lives in this package's `settings.agentLoop` dictionary.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-settings-general](../ui-settings-general/README.md) — the full-page Settings shell and Agents navigation group.
- [ui-settings](../ui-settings/README.md) — the settings scope and the served-namespace watch the page rides.
- [ui-primitives](../ui-primitives/README.md) — the settings form model and fields the page renders.
- [agent-loop](../../core/agent-loop/README.md) — the loop that registers the `agent-loop` namespace.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One field of the namespace** — the Host section carries only the parallel cap; the composed `agents` array is boot composition, not a user setting, and has no field here.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
