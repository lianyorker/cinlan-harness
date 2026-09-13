---
description: "Approval and monotonic enforcement for desktop observation and input."
kind: "package-reference"
---

# @deepseek-ai/dsh-computer-use-permission-policy

English | [中文](README.zh.md)

## Summary

Approval and monotonic enforcement for desktop observation and input.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)

<a id="use-this-package"></a>
## Use this package

This permission-policy Consumer classifies the six desktop Computer Use tools into independent observation, pointer, keyboard, and accessibility-mutation decisions. It contributes a `tools/pre-execute` decision and a matching monotonic `ctx.tools.guard`, so an earlier waterfall listener cannot force-allow a call that bypassed this policy.

## Configuration

| Key | Default | Tools |
|---|---|---|
| `observe` | `ask` | `computer_list_apps`, `computer_list_windows`, `computer_observe` |
| `pointer` | `ask` | `computer_pointer` |
| `keyboard` | `ask` | `computer_keyboard` |
| `accessibilityAction` | `ask` | `computer_accessibility` |

Each value is exactly `allow`, `ask`, or `deny`. Unknown keys and other values fail during plugin setup.

`allow` delegates to the remaining policy chain. `ask` returns a class-specific approval reason and admits only that exact `ToolExecution` to the monotonic guard. `deny` returns a class-specific denial before the Computer Use Provider runs. Non-Computer-Use tools always delegate unchanged.

## Model Experience

### Permission outcomes

#### What the model sees

Allowed and approved calls produce the ordinary [`computer_*`](../tool-computer-use/README.md) result. Calls that do not proceed expose the configured class's approval or denial text through the tool error path; the policy adds no system prompt or tool definition.

##### Approval and denial text

```markdown
Allow this call to observe local desktop applications or window content?
Allow this call to click, scroll, or drag in a local desktop application?
Allow this call to send keyboard or clipboard input to a local desktop application?
Allow this call to perform an accessibility action or set a desktop element value?
Desktop observation is denied by policy.
Desktop pointer input is denied by policy.
Desktop keyboard or clipboard input is denied by policy.
Desktop accessibility mutation is denied by policy.
```

#### Token effect

Only denied or unapproved calls add policy-owned error-result tokens. Allowed and approved calls add no policy-owned model content.

#### KV Cache effect

Policy outcomes append after the reusable request prefix. Changing a permission decision does not change the prompt or tool definitions.

## Known Limitations and Deferred Work

- Policy is class-based, not application-, process-, window-, element-, action-name-, coordinate-, or session-grant based.
- `computer_keyboard` covers literal typing, clipboard paste, key press, and hotkey; this policy cannot approve those sub-actions independently.
- The policy does not authorize Browser, Mobile Device, emulator, simulator, microphone, speaker, Speech/Audio, or network operations.

No runtime invariant companion is published: provider registration, protocol validation, and observation freshness are enforced by their owning operations and covered by the package tests.

### Dev Note

None.
