---
description: "Notifications Settings page and browser notification delivery."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-notifications

[English](README.zh.md) | 中文

## Summary

This package provides the Notifications Settings section: global enablement, agent completion, terminal bell, notification sound, and focus suppression. Loopback browsers persist the choices in the `notifications` Settings namespace and use the browser system notification API for running-to-idle agent completion events and terminal bell characters in tool results. The test button requests permission from a user gesture.

## Use this package

```yaml
- name: '@deepseek-ai/dsh-notifications'
- name: '@deepseek-ai/dsh-client-ui-notifications'
```

The page registers through `settings.section` and does not modify the settings shell. The runtime listens to `api-session/status` and emits one completion notification for each observed `running -> idle` edge. It also subscribes to each session's event source and emits a terminal bell notification when a `tool/result` event contains the BEL character (`\u0007`).

## Model Experience

None. The package never enters model requests or KV cache.

## Known Limitations and Deferred Work

Custom sound files remain playable for the current browser lifetime; their file name is persisted for display.
