---
description: "Manage saved SSH hosts and their connection details from native Settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-hosts

English | [中文](README.zh.md)

## Summary

Manage saved SSH hosts from Settings → Capabilities & connections → SSH remote hosts. Add a target from one destination field — a bare host, `user@host:port`, or an OpenSSH alias — refine it with an account, port, identity file, proxy command, jump host, connection reuse and a connection deadline, then test, connect, edit or delete it. Import prefills the form from the managing Host's OpenSSH Host entries without writing that file. Existing Workspaces and Sessions retain their captured execution binding.

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

Mount this browser contribution alongside Settings, Locale, and the execution-host Remote controller. It has no configuration fields. The page accepts a display label and one destination, and it does not collect secrets, raw URLs, or remote commands.

The form takes one host-or-alias field and folds what it carries into the account and port fields beside it, so `deploy@server:2222` becomes an alias plus its destination details. The alias stays the destination. Every saved connection field appends after the connection's own OpenSSH options, so a saved value overrides the OpenSSH configuration the alias resolves to and an omitted field leaves that configuration alone; the port the form shows is always saved, so an alias whose OpenSSH configuration uses a different port must have that port entered here, which Import does for you.

Two Advanced controls record only their non-default choice: connection reuse is saved as an explicit opt-out, because reuse is the capability default, and the connection timeout field saves the stated seconds as the record's `connectTimeoutSeconds` — the deadline OpenSSH receives as `-o ConnectTimeout` — while an empty field leaves the record without one and keeps the plugin default. Test dials a throwaway connection and publishes nothing; its stable codes (unreachable, authentication-required, host-key-mismatch, timeout, incompatible) are what the card renders. Import reads the managing Host's OpenSSH Host entries and only prefills the form — the configuration file is never modified, and saving stays a separate confirmation.

A connected target also offers Reset remote relay. It admits the same exact revision again, which the owner serves by closing the running worker incarnation and dialling a fresh one, so the card reports the connection that replaced it. Requesting that replacement needs no separate Host operation: connecting a target that already holds a connection is what replaces it.

Saving, deleting, and connecting use the target revision. A conflict refreshes the target list while retaining the editor's destination and refinements for review and explicit retry. A ready card reports the connection status the Host published; directory inspection and runtime installation are owned by other surfaces and are not part of this page.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The apply closure unwraps typed Remote results without replacing failures and supplies plain callbacks to the presentation components. A private observable follows Host snapshots; the renderer binds its read hook. The draft, the open dialogs and the operation status remain component-local. Metadata contributes localized public search labels and native anchors; target values never enter the search index.

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

None; target management does not enter provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- SSH authentication and host-key trust must already be configured on the managing Host. An execution-host worker must export at least one configured root; no current-directory fallback is used.
- This page manages saved hosts only. Installing or updating an execution runtime, inspecting exported directories, and the unavailable Session default rows are not part of it: their Remote methods and Host services remain, but no surface here calls them.
- The reference card also offers End remote terminals. No surface here can back it: the worker advertises directory inspection only, and this product's terminal sessions are owner-scoped to the managing Host, so a saved target has no remote terminal to end. The action is left out rather than shipped unable to act.
- A private-key passphrase stays unsupported: `test` and `connect` accept only an exact target revision, and the connection runs in batch mode, so no prompt exists to answer. The page reports `authentication-required` as a key-or-agent problem instead of collecting a secret it cannot use.
- This connection always dials `-S none`, so a saved connection-reuse choice does not refine it. The opt-out is still recorded because the SSH execution capability consumes it for a captured deployment.
- A saved connection deadline is stored as `connectTimeoutSeconds`, and it is what OpenSSH receives as `-o ConnectTimeout`, so it bounds dialing only. The reference form's terminal-lifetime pair is not implemented: no switch keeps a terminal alive and no field bounds a terminal after disconnect, because this page has no remote terminal to bound. The sidebar terminal plugin decides that grace period in its own deployment configuration.
- The page description promises files, terminals, Git and workspaces over SSH; files, terminals and Git hold, and workspaces do not. Remote Workspace isolation and worktree-task creation are refused until their consumers use the same execution world, and the shipped remote composition excludes project instruction and filesystem skill discovery ([execution-binding](../../execution-host/execution-binding/README.md#limitations)).
- Import lists concrete Host entries only: wildcard and negated patterns and every keyword after a `Match` block are skipped, and `Include` is not followed.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Package tests cover callback error preservation, destination splitting and validation, the Advanced disclosure and its optional connection deadline, probing and its typed failures, delete confirmation, import prefill, snapshot observation, registration disposal, and one real Loader composition that edits a target through the generated Remote codecs.

</details>
