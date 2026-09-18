---
description: "Manage saved MCP servers, credential references, live connection state, and discovered tools in native settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-mcp

English | [中文](README.zh.md)

## Summary

Manage MCP servers for the current profile from Settings → MCP. Add or edit stdio and Streamable HTTP configurations, enable saved records, reconnect owned servers, and inspect actual tool descriptors. Saved enablement, pending application, and observed connection state appear separately. Credential fields accept variable references rather than secret values.

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

Choose this contributor when the Host provides current-profile MCP management and the browser provides the settings, locale, connection, and generated Remote services. The section reads real Host snapshots; it contains no sample server entries.

### Composition

The package mounts as a Cordis plugin row. Its Node entry has no Host behavior; its browser entry contributes the `mcp` section to the Experimental group. The controller and manager own connection and persistence behavior.

```yaml
- name: "@deepseek-ai/dsh-client-ui-settings-mcp"
```

This plugin has no configuration fields. Desired server configuration belongs to the MCP manager, not to this plugin row.

### Edit and inspect servers

Add server remains available when the loaded managed list is empty. Save sends the complete desired record with the revision captured when the draft opened. Cancel discards the draft. A rejected save retains the draft and its revision; after a conflict, cancel and reopen to edit the current record. A successful save confirms persistence, not connection readiness. A shutdown failure can follow persistence; the current snapshot shows the saved desired state.

The form edits the lexical server namespace, enabled flag, transport, command, one literal argument per line, working directory, environment reference rows, endpoint URL, and header reference rows. A header prefix preserves whitespace, including the trailing space in `Bearer `. URLs must use HTTP or HTTPS and exclude userinfo, query strings, and fragments. Credential references are variable names such as `MCP_TOKEN`; the form never accepts raw environment or header credential values.

Enable and Disable change the saved desired state. Reconnect targets enabled managed records. Refresh tools requests `tools/list` on an initialized managed connection, invokes no tool, and starts no disabled server. The button is available for enabled ready or error rows; the Host rejects the request when that row has no active initialized connection. Composition rows are read-only and display their actual reported owner.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [registration](src/client/index.ts) owns one [Remote source](src/client/source.ts) for the plugin lifetime. Connection generations cancel old readers and discovery requests; disposal waits for owned work. A stable observable publishes complete snapshots through the framework hooks compartment. Components subscribe only through framework-provided hooks. The [interaction store](src/client/store.ts) holds drafts and removal confirmation separately from Host readback.

Settings metadata contains localized static copy and persistent page anchors. Server names, endpoints, reference names, tool names, and tool descriptions never enter the settings search index. Remote failures map to fixed local messages; exception and transport text never render. The [tests](tests/) cover draft preservation, async races, actual SlotRegistry and metadata lifetimes, and component behavior. The [visible expectation](tests/expected/native-states.expected.md) pins keyless empty, error, and native server output; assembled browser and Host composition evidence belongs to the application integration.

No runtime invariant companion is published: this package owns presentation and interaction state, while the manager owns the independently observed desired and live connection relationship.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these owners for the surrounding behavior.

- [MCP management types](../../mcp/mcp-management/src/types.ts) — saved records and complete readback.
- [MCP controller](../../api/mcp-controller/src/index.ts) — typed Remote operations.
- [Web Client Slots](../../../docs/subsystems/slots.md) — registration and framework hooks.
- [Web styling](../../../docs/web-styling.md) — semantic tokens and native control styling.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the MCP manager, which applies the connection changes requested by these controls.

#### KV Cache effect

This UI creates no provider requests; the MCP manager owns the cache effects of changes to available Tools.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The editor manages Tools and preserves configuration it does not expose.

- Tool timeout and reconnect overrides are preserved verbatim on edit but have no form controls. Omitted values remain omitted and use bridge defaults.
- Existing argument arrays survive unchanged edits, including embedded newlines. Editing the argument text uses one argument per line and cannot author an embedded newline inside one argument.
- Composition-owned connections cannot be edited or removed here. Refresh tools availability is an invitation to request discovery; the Host checks whether the connection is active.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
