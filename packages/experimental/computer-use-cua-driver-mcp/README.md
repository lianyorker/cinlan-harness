---
description: "Configure experimental local computer use with an installed Cua Driver MCP executable and exclusive provider registration."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp

English | [中文](README.zh.md)

## Summary

Let the model operate the local desktop through an already installed Cua Driver. Mount this package with the computer-use service to expose the driver's own tool descriptions, arguments, and results through MCP. Installation and desktop permissions remain with Cua Driver, and no driver activates by default. The provider reserves computer use until its connection and tools finish closing; callers coordinate concurrent Sessions themselves.

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

Choose this provider when Cua Driver is already installed and configured on the same machine as DSH. The [upstream installation and permissions guide](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.0/libs/cua-driver/README.md) owns platform setup.

This plugin does not download a driver. Supply an executable `cua-driver` (upstream compatibility reference: `0.28.0`) and access to a logged-in graphical session. On macOS, the usual installation uses a `CuaDriver.app` daemon with Accessibility and Screen Recording grants; `args: [mcp, --direct]` uses the launching host's permissions instead. Windows needs the driver for its architecture and remains subject to UIA/process integrity limits. Linux needs the corresponding X11 or supported Wayland/AT-SPI/compositor setup; see the [upstream platform ledger](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.0/libs/cua-driver/docs/action-support.md) for operation support. Installation does not grant desktop access.

Mount one Cua Driver adapter and unload any registered Cinlan Computer Use provider first. If the composition includes Cinlan's `tool-computer-use` and permission policy, disable those consumers when selecting Cua Driver; Cua Driver publishes its own arguments and tool names, and the Cinlan-specific permission policy does not govern them. This package does not activate automatically or change the Cinlan default composition.

### Minimal configuration

Add these rows to a composition that already provides tools and system-prompt services. Screenshots also require an attachment store and a model route declaring image input.

```yaml
- name: '@deepseek-ai/dsh-computer-use'
- name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp'
  config:
    command: cua-driver
    args: [mcp]
```

| Field | Default | Meaning |
|---|---|---|
| `command` | `cua-driver` | Installed executable path or PATH command |
| `args` | `[mcp]` | Arguments passed directly without a shell |
| `toolCallTimeoutMs` | MCP client default | Per-call timeout override in milliseconds |
| `reconnect` | MCP client policy | Optional reconnection overrides |

The [configuration schema](src/index.ts) defines accepted fields. The [MCP client](../../mcp/mcp-client/README.md) owns timeout and reconnection defaults.

### Activation and ownership

The provider registers as `cua-driver-mcp` before connecting. A second computer-use provider fails activation, including another instance of this package. Failed initialization or initial tool discovery rejects this entry and releases its registration after cleanup. Later disconnects retain the registration while the MCP client reconnects or exhausts its attempt budget; unload the entry after confirmed shutdown to release it. An MCP close timeout retains the registration; restart the host before mounting another provider.

The model sees tools under the fixed `mcp__cua-driver-mcp__` namespace. Tool names, descriptions, input schemas, canonical results, and image admission follow the existing [MCP bridge](../../mcp/mcp-client/README.md). There is no additional DSH action catalog or provider-selection tool.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/index.ts`](src/index.ts) groups the computer-use reservation and owned MCP child into one ordered effect. Child teardown finishes before the reservation disposer runs, including during failed activation. The MCP client owns credential scrubbing, subprocess termination, tool synchronization, cancellation, and durable image projection.

No runtime invariant companion is published: the provider exposes no independent driver state to compare with its registration, and the child owns its connection and tool generations.

### Mock verification

Run the package tests from the repository root. They use a local stdio fixture that returns fixed text and PNG bytes without reading the real desktop or sending input. Loader composition covers durable images, reconnection, and startup rollback; lifecycle tests cover reservation retention after a close timeout. The real driver and platform permissions require separate verification.

```sh
node node_modules/vitest/vitest.mjs run packages/experimental/computer-use-cua-driver-mcp
```

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Computer-use service](../../computer-use/computer-use/README.md) — exclusive named registration.
- [MCP client](../../mcp/mcp-client/README.md) — protocol discovery, execution, and image behavior.
- [Cua Driver](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.0/libs/cua-driver/README.md) — upstream executable and platform setup.

-----

<a id="model-experience"></a>
## Model Experience

### Cua Driver tools and screenshots

#### What the model sees

The installed driver's advertised tool descriptions and input schemas appear under `mcp__cua-driver-mcp__<tool>` names. Successful calls retain ordered text and admitted screenshots; unsupported image routes receive the MCP bridge's diagnostic text. Tool calls and projected results enter the Session log through the normal execution pipeline.

#### Token effect

Registered schemas enter model requests, and tool arguments, text results, and admitted images add context until compaction. Canonical inline image bytes stay outside Session events; durable attachment references identify model-visible images.

#### KV Cache effect

Unchanged tool discovery preserves the tool-definition prefix. Catalog changes can invalidate reuse from the first changed schema onward; appended tool results preserve the preceding request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

This provider relies on the installed driver and the MCP bridge's supported capabilities.

- Desktop access requires upstream installation and platform permissions; plugin activation alone does not prove that every desktop action is permitted.
- Sessions share one desktop. Run one computer-use workflow at a time or coordinate them externally; the registration does not serialize Session actions.
- Driver upgrades can change the discovered catalog. The provider has no runtime driver switching, dedicated desktop permission UI, or DSH action abstraction.
- Startup deadlines and rich-result restrictions follow the [MCP client's limitations](../../mcp/mcp-client/README.md#known-limitations-and-deferred-work).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
