---
description: "Register real keyboard commands and resolve saved shortcuts for local editor and shell handlers."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-keyboard

English | [中文](README.zh.md)

## Summary

This package connects registered actions to the existing `keybindings` preferences. Owners supply stable command ids, focus scopes, translated labels, defaults, and optional live availability. Their local event handlers read the current binding when a key arrives.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this ordinary Host/Client plugin alongside settings and locale. The Host entry registers the durable namespace; the Client entry provides `ctx.keyboard`. [Shortcut settings](../ui-keybindings/README.md) displays the commands supplied by the composed action owners.

An owner augments `KeyboardCommandMap` from `@deepseek-ai/dsh-client-keyboard/client` with each command id and its scope. Register its defaults inside a Cordis effect and return the registration disposer. Supply label and description functions so locale changes republish current copy. An optional availability source disables an action while its owning capability is unavailable.

Owners pass plain `KeyEventFacts` to `matches(id, facts)` from their existing focused handlers. The service owns no document key listener. Lexical, CodeMirror, and the shell retain their own focus, popup, and action arbitration; components receive callbacks and renderer-bound observable sources.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The stored `overrides` array keeps the existing command ids, keys, modifier flags, and nullable bindings. A null binding disables the action. Portable `mod` resolves to Meta on Apple platforms and Ctrl elsewhere. An explicit override replaces all default aliases for its command. Saved records without a registered action remain unavailable and survive unrelated edits.

[The controller](src/client/controller.ts) publishes stable snapshots between changes, detects collisions against effective defaults and overrides within the same scope, and refuses reserved or invalid choices. It rejects already-handled events, IME composition, key code 229, AltGraph, and repeats unless an owner permits repeats. Intrinsic composer Shift+Enter stays reserved for Lexical. Owners still decide whether their local action can run.

Writes are serialized. A changed write succeeds only after a newer accepted revision, the intended raw override, and the matching effective value are observed. An existing matching override needs no write. Resetting the final row or all shortcuts unsets the `overrides` leaf so inherited settings resolve again. Per-row reset removes that command from the user array; configured base overrides follow the settings owner's array replacement semantics.

Disposing a registration removes its command and availability subscription. Disposing the plugin releases settings and locale subscriptions. No runtime invariant companion is published: effective command data is derived from the settings source and current registrations, with registration and dispatch prerequisites enforced by the owning operations.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as keyboard preference records do not enter model requests or Session logs and invoked actions retain their owning feature's behavior.

#### KV Cache effect

None. Binding resolution adds no model input or tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

Only registered actions can be remapped. Native editor gestures and unavailable legacy actions retain their existing ownership. Browser and operating-system reservations are refused; the current interface records one logical key combination, without multi-step chords or physical key-position bindings.
