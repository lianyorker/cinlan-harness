---
description: "Approval and monotonic enforcement for mobile observation and input."
kind: "package-reference"
---

# @deepseek-ai/dsh-mobile-device-permission-policy

English | [中文](README.zh.md)

## Summary

Approval and monotonic enforcement for mobile observation and input.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)

<a id="use-this-package"></a>
## Use this package

This Consumer assigns independent `allow | ask | deny` decisions to the five Mobile Device tools. Every class defaults to `ask`.

| Permission class | Tools |
|---|---|
| `observe` | `mobile_list_devices`, `mobile_observe` |
| `touch` | `mobile_touch` |
| `textInput` | `mobile_type` |
| `deviceNavigation` | `mobile_button` |

The policy participates in `tools/pre-execute` for ordinary approval and installs a monotonic `ctx.tools.guard()` check. A prepended or short-circuiting listener cannot convert an `ask` or `deny` decision into executable input without passing the matching policy path.

## Model Experience

### Permission decisions

#### What the model sees

Denied or unapproved `mobile_*` calls return the configured class reason through the ordinary tool error path. Allowed calls preserve the tool Consumer's output.

#### Token effect

The policy adds only an approval or denial message when a decision blocks execution.

#### KV Cache effect

Permission decisions do not alter the stable system prompt or tool schemas.

## Known Limitations and Deferred Work

- The policy classifies only the five initial Mobile Device tools and grants no Browser, Computer Use, shell, network, or device-lifecycle authority.

No runtime invariant companion is published: provider registration, protocol validation, and observation freshness are enforced by their owning operations and covered by the package tests.

### Dev Note

None.
