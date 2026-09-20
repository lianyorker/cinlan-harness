---
description: "Define integrated sidebar terminal attachments shared by Web and Desktop carriers."
kind: "package-reference"
---

# @deepseek-ai/dsh-sidebar-terminals

English | [中文](README.zh.md)

## Summary

This package defines the integrated sidebar terminal service and browser-safe request types. The [sidebar provider](../../client/ui-better-sidebar/README.md) supplies its existing UI PTY manager and agent terminal registry; the [Remote controller](../../api/sidebar-terminal-controller/README.md) exposes authenticated operations through the shared Web and Desktop carriers.

## Table of Contents

- [Ownership and lifetime](#ownership-and-lifetime)
- [Floating windows](#floating-windows)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="ownership-and-lifetime"></a>
## Ownership and lifetime

UI terminals keep their session/tab identity. Agent terminals keep their existing registry UUID. An attachment id names one connection to one process generation; stale input, resize, and close requests cannot act on a replacement process. An additional process id remains stable across attachment reconnects. Read-only `inspectUi` observes an existing UI process without creating one or extending its lifetime; `closeUi` compares that id before termination, so a persisted tab can close without reopening its view. Capability checks create no process. A stream publishes its opening metadata, acknowledged output frames, and process exit. Data acknowledgment means xterm has finished consuming the frame. The provider limits complete serialized frames and buffered output, owns native pause/resume, and releases its own pauses and listeners when an attachment ends.

`shells` lists installed local executables without spawning. An optional UI target `shellPath` chooses one of those executables for a new process; omission preserves the provider’s Settings default. Existing processes retain their shell across reconnects even if discovery or Settings changes. Agent terminal targets cannot select a shell.

A view may park a UI terminal while its session is hidden, disconnect with a configured reconnect grace period, or close its process explicitly. An attachment cancelled before its newly created terminal is accepted releases that process. Host disposal requests native termination and waits for exit, including processes with no attached view. The provider reports a shutdown timeout if native exit cannot be confirmed. Host restart does not restore processes or commands.

<a id="floating-windows"></a>
## Floating windows

The floating feature supplies a validated window id synchronously and reports accepted directory preferences separately from loading or unavailable state. A new floating UI tab captures the ready directory once. Its id and stored layout include the window UUID; main-tab storage and agent-terminal identities remain unchanged. The Host accepts only an existing directory equal to or canonically inside the associated session workspace. Traversal, symlink escape, and non-directory targets fail before process creation. Main and agent terminals retain their session directory policy.

<a id="model-experience"></a>
## Model Experience

None, as this package adds no tools, messages, or model context.

#### KV Cache effect

No effect: terminal attachments, preferences, and availability queries do not enter the model request prefix.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

The service depends on a provider with a working native PTY dependency.

- Output retained for reconnect is bounded; transport availability does not prove that a user-configured shell can start.
- A renderer that stops acknowledging output can pause the PTY until its attachment times out.
- Core execution terminals remain a separate capability.

No runtime invariant companion is published because this package owns only declarations and an abstract service, with no independently stored observations.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Current native-loader acceptance evidence and remaining verification are tracked in the [acceptance status](../../../.agents/plans/settings-native-acceptance-status.md).

</details>
