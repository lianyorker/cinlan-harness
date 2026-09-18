---
description: "Manage local UTC automations and follow committed definitions, invocation history, and available selectors through Remote."
kind: "package-reference"
---
# Automation Controller

English | [中文](README.zh.md)

## Summary

Use this package to create, edit, pause, delete, run, and cancel local automations through API Gateway. Clients can read committed definitions, page through invocation receipts, and discover the Host's current workspace, preset, model, and permission choices. Failed operations retain the last committed view and expose a stable error code. Scheduling, durable storage, and agent execution remain owned by the automation runtime.

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

Compose the Host package with the automation runtime and its selector services. Compose its `/client` entry with Gateway, Connection, and this package's generated Remote contribution. The package has no configuration fields; deployment scheduling policy belongs to the runtime.

The Host exposes `ctx.automationController` under the generated `automation` namespace. The Client exposes the distinct `ctx.automationClient` service. Supply its stable `source` through a renderer hook binding; presentation components receive snapshot data and plain command callbacks rather than subscribing manually.

The Client distinguishes loading, ready, and unavailable states. Its nullable runtime and catalog values distinguish an unanswered request from a successful empty list. Mutation methods enforce Connection's local-Host authority and expose that same decision as `writable`. Conflicts preserve the committed view and the failure; refresh before submitting another revision-fenced edit. A manual admission retry must retain its request token.

Catalog names and descriptions are source data, not localized product copy. Availability uses stable codes. Missing defaults remain explicit choices; an unlisted model is advisory rather than proof that routing is invalid. No model execution or credential test is performed while loading selectors. Saved choices remain in definition data even when absent from the current catalog.

-----

The controller registers no prompt, tool, or Session event. Catalog reads, schedule previews, and Client subscriptions add no model tokens. Admitted invocations incur the ordinary runtime-selected Agent request cost.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [Host controller](src/index.ts) delegates commands to the runtime and maps failures to `automation/operation-failed` with a runtime code and bounded public message. Underlying provider and storage diagnostics do not cross Remote. The [catalog adapter](src/catalog.ts) reads current service metadata; it does not resolve or persist a draft.

Each [follow stream](src/feed.ts) opens with a full committed snapshot and coalesces updates into one pending replacement per slow reader. Cancellation and Host disposal wake waiting readers. The [Client](src/client/index.ts) uses Gateway stream supervision and Connection generations to reject late responses, retain committed values during failures, and own one selected paginated journal query. Subscriber exceptions are contained, and disposal prevents late publication.

No runtime invariant companion is published: the controller owns no independent durable data to compare against the runtime, and Client transport state is intentionally allowed to lag during disconnection.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Automation runtime](../../automation/automation/README.md) — scheduling, admission, and durable receipts.
- [API Gateway](../gateway/README.md) — generated Remote transport and stream supervision.
- [Workspace controller](../workspace-controller/README.md) — workspace navigation and registration.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the [automation runtime](../../automation/automation/README.md), which owns the Agent input and Session evidence for admitted requests.

#### KV Cache effect

The controller changes no model request prefix or cache setting; the runtime-selected Agent composition and model own those effects.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Follow reconnects replace the full committed view; the stream has no durable replay cursor.
- Catalog reads reflect available services at read time, not a reservation of resources for a future invocation.
- Reasoning-effort choices are not synthesized from advisory model lists; explicit saved and default selections retain their values for runtime validation.
- One Client instance retains one selected journal query; selecting another definition replaces that query, and a committed runtime revision refreshes the selected first page.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
