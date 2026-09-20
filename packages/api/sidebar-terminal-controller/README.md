---
description: "Attach sidebar terminals through authenticated Remote streams, send input, and acknowledge rendered output."
kind: "package-reference"
---
# Sidebar Terminal Controller

English | [中文](README.zh.md)

## Summary

Web and Desktop clients can attach to sidebar terminals, send input, resize displays, and acknowledge rendered output through one Remote namespace. Clients can also watch the agent terminal list and close a selected agent terminal. Web requests require Connection authentication; this package does not create a terminal-specific server or transport.

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

Mount the controller beside `typert` and the provider of `ctx.sidebarTerminals`. The application supplies [Gateway](../gateway/README.md) and [Connection](../../client/connection/README.md); the existing Desktop carrier can use the same Remote methods without a Web server. The controller has no configuration fields.

```yaml
- name: '@deepseek-ai/dsh-api-sidebar-terminal-controller'
```

The `sidebarTerminals` Remote namespace exposes the [service operations](../../terminal/sidebar-terminals/src/index.ts). Keep the `open` stream alive while rendering a terminal, and send its attachment identity with input, resize, acknowledgement, and release requests. Acknowledgements identify rendered output sequences, not received bytes. The provider owns process generations and release dispositions. `inspectUi` returns the existing UI process identity without spawning or extending its lifetime; `closeUi` compares that observed identity and refuses a replacement process.

`shells` and the Client callback `terminalShells()` return installed local executable paths and names without creating a process. UI targets may include `shellPath`, a nonempty, control-free string of at most 4096 characters. The provider accepts only currently discovered choices when spawning; omission keeps the Settings default, while reattachment preserves a live process. Agent targets reject shell selection. An unavailable explicit choice reports `sidebarTerminals/invalid-shell`.

Wire dimensions are integers from 1 through 1024. Session identities are nonempty, control-free strings of at most 256 characters. Main tabs retain opaque `terminal:<id>` identities, with 1–128 ASCII letters, digits, underscores, or hyphens after the prefix; floating tabs require `terminal:<windowUUID>:<counter>` matching their supplied window. Floating counters are canonical nonnegative safe integers. Attachment, window, and agent identities use lowercase UUID format. Floating directory strings are at most 4096 characters and cannot contain NUL; the provider resolves and authorizes their filesystem targets.

The complete JSON input request object, including attachment metadata and escaped characters, is limited to 64 KiB of UTF-8. Oversized requests must be split by the client. ACK sequences are nonnegative safe integers; release accepts only `disconnect`, `park`, or `close`. Unexpected request fields are rejected rather than forwarded.

Operational failures use typed `sidebarTerminals/*` codes with stable messages, without private provider diagnostics. Directory failures report “Choose an existing directory inside the session workspace”. Unclassified failures use `sidebarTerminals/operation-failed`. Cancellation remains a carrier failure rather than a terminal operation failure.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[SidebarTerminalController](src/index.ts) validates Remote arguments and delegates to the single injected provider. It does not own a PTY registry or buffer output. [Validation](src/validation.ts) applies only to incoming Remote calls; typed same-process provider calls retain the service definition's requirements. [Error translation](src/errors.ts) gives unary calls and stream iteration the same public diagnostics.

The Client entry provides React-free callback scopes through `ctx.sidebarTerminalClient()`. Each sidebar activation owns and awaits one scope; provider teardown withdraws the factory and awaits every remaining scope. The adapter uses the existing `RemoteStream` for Connection generation changes, acknowledged rendering, and read-only identity lookup when closing a persisted tab whose view has not reopened.

The controller combines stream cancellation with its Cordis lifetime, checks cancellation before provider entry, and awaits provider iterator cleanup on disposal even when a client pauses iteration. Removing the Loader entry withdraws Remote discovery. No invariant companion is published because the controller owns no independently observable terminal state to compare with the provider; iterator cleanup is a lifecycle obligation covered by composition tests.

[Composition tests](tests/controller.host.spec.ts) load the production Gateway, Connection, credentials, and controller through a real Loader. They exercise source discovery, authenticated HTTP and WebSocket mux calls, validation, cancellation, and disposal with an external terminal provider fixture. Provider process integration belongs to the sidebar provider's tests.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Service definition](../../terminal/sidebar-terminals/src/index.ts) — provider operations and attachment lifetime.
- [Gateway](../gateway/README.md) — Remote dispatch and shared stream multiplexing.
- [Connection](../../client/connection/README.md) — Web authentication and unary carriers.

-----

<a id="model-experience"></a>
## Model Experience

None, as terminal Remote calls return client data without adding tools, messages, or model context.

#### KV Cache effect

No effect: this controller adds no prompt tokens and changes no model request prefix.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

The controller depends on provider and carrier ownership for the following behavior.

- Directory existence, workspace containment, PTY availability, and stale attachment refusal remain provider responsibilities.
- Provider iterators must cooperate with abort signals and settle their cleanup; controller disposal awaits that work instead of abandoning it.
- Clients must keep input requests within the JSON byte limit and acknowledge rendered output; the controller does not split input or grant output credit automatically.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
