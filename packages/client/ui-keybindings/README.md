---
description: "Inspect and customize the effective shortcuts supplied by mounted action owners."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-keybindings

English | [中文](README.zh.md)

## Summary

The Shortcuts page lists real registered actions with their effective bindings. Search the list, record a replacement combination, unbind an action, or restore defaults. Saved legacy records without an action remain visible as unavailable.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this page with [keyboard](../keyboard/README.md), settings, slots, and locale. Action owners register their own commands; this page does not invent defaults. Composer submission and completion, file save/find/replace, and sidebar visibility appear while their owners are mounted. Other plugins can contribute typed commands through the keyboard service.

Choose Record and press a combination while focus stays inside the page. Escape cancels recording. IME input and modifier-only presses are ignored. Browser reservations and conflicts with another action's effective binding in the same focus scope show an explanation. A saved choice takes effect on the next key event; no reload is needed.

Unbind stores a null binding. Reset removes the selected user override, and Restore all shortcut defaults unsets the override array, including unavailable records. Loading, unavailable, and read-only settings disable editing. A failed write preserves the accepted binding and offers an explicit retry of the same choice.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [page](src/client/KeybindingsSection.tsx) consumes a renderer-bound keyboard snapshot and plain commands. Its recorder uses a local capture handler; it installs no global key listener. Search navigation clears the page filter before revealing its `keybinding-{commandId}` anchor.

The [plugin](src/client/index.ts) registers the personal-preferences section, command search items, and the reset anchor under the settings slot's lifetime. Search indexes only registered action labels and descriptions, excluding saved bindings and unavailable user ids. Registry changes republish metadata, and slot collapse or plugin disposal removes it.

No runtime invariant companion is published: this page renders the keyboard owner's snapshot and retains only local search, recording, and pending-operation state.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as this page changes keyboard preferences without altering model requests, tools, or Session records.

#### KV Cache effect

None. Shortcut settings add no model input or tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

Only actions registered by a real consumer are editable. Intrinsic Shift+Enter newline remains owned by Lexical; a saved `conversation.newLine` override is preserved as unavailable. Recording supports one logical key combination and remains subject to the keyboard owner's platform reservation rules.
