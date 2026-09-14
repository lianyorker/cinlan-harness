---
description: "Host settings namespace for desktop notification preferences."
kind: "package-reference"
---

# @deepseek-ai/dsh-notifications

[English](README.zh.md) | 中文

## Summary

This package registers the `notifications` Settings namespace for desktop notification preferences: global enablement, agent completion, terminal bell, notification sound, and focus suppression. Browser delivery belongs to `dsh-client-ui-notifications`.

## Use this package

```yaml
- name: '@deepseek-ai/dsh-settings-file'
- name: '@deepseek-ai/dsh-notifications'
```

The namespace defaults to all switches disabled and the `system` sound. The client reads and writes it through `ctx.settingsScope`.

## Model Experience

None. This package does not change prompts or tool results.

## Known Limitations and Deferred Work

The Host registration does not call an operating-system notification API; the active client runtime owns delivery for its environment.
