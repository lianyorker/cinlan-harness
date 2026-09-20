---
description: "Run Cua Driver computer-use tools from its native npm SDK, with durable screenshots and explicit host desktop permissions."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-computer-use-cua-driver-native

English | [中文](README.zh.md)

## Summary

Use Cua Driver to inspect and operate desktop windows without installing its separate CLI or application. The native npm dependency runs inside the DSH host and exposes Cua Driver's own tools. Screenshots reach image-capable models through durable attachments. This published experimental package requires the launching host's desktop permissions and remains an explicit composition choice.

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

Mount the provider in a composition that already supplies the tool registry and system prompt.

Mount one Cua Driver adapter and unload any registered Cinlan Computer Use provider and `tool-computer-use` first. Keep the [permission policy](../../computer-use/computer-use-permission-policy/README.md) mounted: its `native` decision covers all `cua_driver_native__*` tools and defaults to `ask`. The opt-in [computer-use bundle](../../bundle/cinlan-computer-use/README.md) supplies this composition.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-computer-use'
  config:
    provider: cua-driver-native
- name: '@deepseek-ai/dsh-computer-use-permission-policy'
  config:
    native: ask
- name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'
```

The provider has no configuration fields. It loads the exact Cua Driver npm version declared in [package.json](package.json) and uses its same-process defaults. Native import, runtime initialization, malformed catalog, duplicate tool name, or occupied computer-use registration failures reject activation and roll back owned resources. The registered provider name is `cua-driver-native`.

Use an attachment store and a model route that explicitly declares image input to receive screenshots. The [MCP result adapter](../../mcp/mcp-client/README.md) owns image admission and diagnostic behavior; programmatic callers retain the canonical raw result when a model cannot receive its images. Calls use Cua Driver's upstream tool parameters and results.

### Host requirements

The native dependency supplies platform binaries through npm optional dependencies. Keep optional dependencies enabled. Grant desktop permissions to the application that launches DSH; this provider neither installs a permission-owning app nor changes OS grants. The native runtime shares the host process, so native crashes can terminate that process. Use the [installed MCP provider](../computer-use-cua-driver-mcp/README.md) when the separate Cua Driver application should own permissions and execution.

The pinned [`@trycua/cua-driver@0.28.0` manifest](https://registry.npmjs.org/@trycua/cua-driver/0.28.0) declares optional binaries for macOS x64/arm64, Windows x64/arm64 (MSVC), and Linux x64/arm64 (glibc); it includes no musl package. A logged-in graphical session is required. macOS requires Accessibility and Screen Recording grants for the application launching DSH; Windows UIA/input is subject to process integrity restrictions; Linux capture/input depends on X11/Wayland, AT-SPI, and compositor facilities. Consult the [upstream platform ledger](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.0/libs/cua-driver/docs/action-support.md) and runtime results for supported operations.

The JavaScript SDK wrapper is MIT licensed; its platform payloads declare `MIT AND MPL-2.0`. Distribution must retain their license material and the UniFFI N-API runtime notice, together with the DLL/shared library and Node addon at the relative paths expected by the SDK. The [public experimental package policy](../../../scripts/experimental-package-policy.ts) explicitly admits this package. It adds no downloader or standalone service.

### Mock verification

Run the package tests from the repository root. They replace the native module with a mock SDK and use fixed PNG bytes to verify image persistence, Loader composition, cancellation, and shutdown ordering. They neither read the real desktop nor send input or inspect private windows. Live platform permissions and desktop operations require separate verification.

```sh
node node_modules/vitest/vitest.mjs run packages/experimental/computer-use-cua-driver-native
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider reports `initializing` while reserving computer use and discovering the SDK catalog. It reports `ready` only after a validated nonempty catalog, every tool, and prompt guidance are registered. Disposal immediately clears advertised tool names and reports `disposing`; initialization or shutdown failure reports `failed`. Permissions remain `unknown`. Successful cleanup after initialization failure releases registration; shutdown failure keeps it failed and reserved.

The provider reserves the shared computer-use registration before loading native code. A child plugin owns discovery, model tools, and guidance; the outer effect owns the native driver and shutdown. The parent retains the registration until child teardown has removed tools, interrupted native calls and image-capability admission, awaited settlement, and completed native shutdown. Cancellation does not undo input already delivered to an application.

| File | Role |
|---|---|
| [src/index.ts](src/index.ts) | Native runtime ownership, catalog validation, tool registration, and provider guidance |
| — | No runtime invariant companion is published; resource ownership has no independently observed state to compare. |

Tool definitions reuse the existing MCP result adapter. Cua Driver's JSON catalog determines the schemas; its raw result supplies canonical text, structured output, and image bytes. This adapter uses the computer-use service's exclusive registration and readiness callback. Its tools keep upstream requests and results; it implements no facade action DTOs.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Computer-use service](../../computer-use/computer-use/README.md) — exclusive named registration.
- [MCP client](../../mcp/mcp-client/README.md) — shared result and image projection.
- [Cua Driver SDK](https://cua.ai/docs/reference/cua-driver/sdk-reference) — upstream runtime API and host facilities.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

The provider contributes the following computer-use guidance while its native tools are mounted.

##### Native Cua Driver guidance

```markdown
Cua Driver native computer-use tools operate the host desktop. Discover the exact app and window, then get a fresh window snapshot before acting. Use element_token from that snapshot, or coordinates from its screenshot. A new snapshot of that window invalidates its earlier element tokens. Select either target or the legacy pid/window_id fields; do not combine them.

Prefer background delivery. A refusal does not authorize a foreground retry. Verify the requested outcome from fresh state after an action; a delivered click alone does not prove the outcome. After cancellation, inspect current state before retrying because completed input is not rolled back. Other sessions and applications may change the same desktop.

On macOS, cursor-overlay operations may return facility_unavailable even when screenshots and input work.
```

#### Token effect

This fixed guidance adds system-prompt tokens while the provider is mounted. Upstream guidance resources are not automatically loaded.

#### KV Cache effect

The unchanged guidance preserves its repeated prompt prefix. Mounting, removing, or editing it changes that prefix and can reduce cache reuse.

### Discovered Cua Driver tools and results

#### What the model sees

Tools use the `cua_driver_native__` prefix followed by the upstream name and retain the upstream descriptions and input schemas. Upstream tool refusals become tool errors. Supported screenshots appear as durable image references beside result text; the canonical raw result remains available to programmatic callers.

#### Token effect

The discovered catalog adds tool definitions to each request. Accessibility trees, result text, and admitted screenshots add per-call context. Raw base64 remains in execution-local canonical values and is not copied into model history.

#### KV Cache effect

An unchanged catalog preserves its tool-definition prefix. Tool results append to Session history. Replacing the provider or its catalog changes the model-visible tools and can reduce prefix reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The package preserves the upstream driver's platform and application limits.

- **Host permissions and graphics session** — npm installation and catalog readiness do not grant desktop access or prove GUI actions work. Controlled GUI verification and packaged native loading remain separate evidence.
- **Windows delivery** — x64 and arm64 packages require a logged-on graphical session; UIA/input remains subject to UIPI. Upstream background refusals such as `background_unavailable` and `background_occluded` remain refusals and do not authorize foreground retries.
- **Native cursor overlay** — a headless macOS Node host can receive `facility_unavailable` for overlay operations while screenshots and background input remain usable.
- **Shared desktop** — the provider does not reserve windows or complete workflows for a Session. Other callers and applications can change the same desktop between calls.
- **Cancellation** — an aborted call can have delivered input already; inspect fresh state before retrying. The provider waits for SDK shutdown during unload but does not promise native action rollback.
- **Failed shutdown** — if native shutdown fails, the registration remains occupied. Restart the host before mounting another computer-use provider.
- **Experimental release** — tool schemas follow the pinned upstream SDK and have no DSH stability promise.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
