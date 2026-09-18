---
description: "Manage saved SSH execution hosts and inspect their exported directories from native Settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-hosts

English | [中文](README.zh.md)

## Summary

Manage saved SSH targets from Settings → Experimental → Execution hosts. Add a label and an existing OpenSSH alias, then explicitly connect to inspect exported directories. The current local Host remains a read-only process record. Connections do not change the execution authority of Workspaces or Sessions.

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

Mount this browser contribution alongside Settings, Locale, and the execution-host Remote controller. It has no configuration fields. The page accepts a display label and an SSH alias that references the Host's existing OpenSSH configuration and authentication; it does not collect secrets, raw URLs, or remote commands.

Saving, deleting, and connecting use the target revision. A conflict refreshes the target list while retaining the editor's label and alias for review and explicit retry. Connection readiness requires the worker handshake and a successful initial inspection of an exported root. The directory inspector accepts one exported root and a relative path, displays returned entries, and identifies truncated results.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The apply closure unwraps typed Remote results without replacing failures and supplies plain callbacks to the presentation components. A private observable follows Host snapshots; the renderer binds its read hook. Forms and inspection results remain component-local. Metadata contributes localized public search labels and native anchors; target values never enter the search index.

No invariant companion is published: this package owns presentation state and derives target state from the controller, without an independent durable record to compare against that state.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Settings](../ui-settings/README.md) — native navigation and search metadata.
- [Web Client](../../../docs/subsystems/web-client.md) — Remote communication and presentation ownership.
- [Slots](../../../docs/subsystems/slots.md) — renderer-bound hooks and callbacks.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; target management and directory inspection do not enter provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Default Session host, switch confirmation, and task isolation remain unavailable because remote Workspace/Session authority routing isn't implemented. The page stores no preferences for these rows.
- SSH authentication and host-key trust must already be configured on the managing Host. An execution-host worker must export at least one configured root; no current-directory fallback is used.
- Inspection is read-only and confined by the worker's exported roots. A saved target id identifies configuration, while the current Host and worker Host ids identify process provenance.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Package tests cover callback error preservation, native form behavior, snapshot observation, and registration disposal.

</details>
