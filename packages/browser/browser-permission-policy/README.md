---
description: "@deepseek-ai/dsh-browser-permission-policy"
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-permission-policy

English | [中文](README.zh.md)

## Summary

This package owns one layer of the persistent Browser capability; its detailed service, provider, policy, or tool contract is defined by the sections below.

## Table of Contents

- Summary
- Model Experience
- Known Limitations and Deferred Work
- Dev Note

This permission-policy Consumer classifies persistent-browser tools into independent observe, navigate, and interact decisions. It contributes a `tools/pre-execute` decision and a matching monotonic `ctx.tools.guard`, so an earlier waterfall listener cannot force-allow a call that bypassed this policy.

## Configuration

| Key | Default | Tools |
|---|---|---|
| `observe` | `ask` | `browser_list`, `browser_snapshot`, `browser_screenshot`, `browser_select_element`, `browser_capture_element`, `browser_history`, `browser_network`, `browser_downloads` |
| `navigate` | `ask` | `browser_open`, `browser_navigate`, `browser_home`, `browser_search`, `browser_back`, `browser_forward` |
| `interact` | `ask` | `browser_click`, `browser_close`, `browser_upload`, `browser_save_download` |

Each value is exactly `allow`, `ask`, or `deny`. Unknown keys and other values fail during plugin setup.

`allow` delegates to the remaining policy chain. `ask` returns a class-specific approval reason and admits only that exact `ToolExecution` to the monotonic guard. `deny` returns a class-specific denial before the browser provider runs. Non-browser tools always delegate unchanged.

## Model Experience

### Permission outcomes

#### What the model sees

Allowed and approved calls produce the ordinary [`browser_*`](../tool-browser/README.md) result. Calls that do not proceed expose the configured class's approval or denial text through the tool error path; the policy adds no system prompt or tool definition.

##### Approval and denial text

```markdown
Allow this call to observe persistent browser tabs or page content?
Allow this call to open or navigate a persistent browser page and contact its destination?
Allow this call to interact with or close a persistent browser page?
Persistent browser observation is denied by policy.
Persistent browser navigation is denied by policy.
Persistent browser interaction is denied by policy.
```

#### Token effect

Only denied or unapproved calls add policy-owned error-result tokens. Allowed and approved calls add no policy-owned model content.

#### KV Cache effect

Policy outcomes append after the reusable request prefix. Changing `observe`, `navigate`, or `interact` does not change the prompt or tool definitions.

## Known Limitations and Deferred Work

- Policy is class-based, not URL-, origin-, page-, element-, or session-grant based.
- `browser_close` shares the interact class because it mutates persistent browser state even though it does not contact a new destination.
- The policy does not authorize OS Computer Use; a desktop capability requires its own decisions and guards.


<a id="dev-note"></a>
### Dev Note

The package keeps transport, policy, and model-facing responsibilities in their dedicated layers; generated artifacts are not hand-edited.

No runtime invariant companion is published because ToolRuntime consumes each admission decision within its owned execution.
