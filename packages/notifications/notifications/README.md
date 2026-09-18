---
description: "Host settings namespace for desktop notification preferences."
kind: "package-reference"
---

# @deepseek-ai/dsh-notifications

English | [中文](README.zh.md)

## Summary

Store desktop notification preferences across Host restarts: enablement, agent completion, terminal bell, sound, focus suppression, and daily do-not-disturb hours. Configure them through [the notification settings page](../../client/ui-notifications/README.md), which also owns browser delivery.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

```yaml
- name: '@deepseek-ai/dsh-settings-file'
- name: '@deepseek-ai/dsh-notifications'
```

The `notifications` namespace defaults to all switches disabled, the `system` sound, and quiet hours from `22:00` to `08:00`. The Host validates both quiet times as 24-hour `HH:mm` strings before persistence. The Client interprets them in its local timezone: start inclusive, end exclusive, crossing midnight when the start is later; equal times suppress automatic alerts all day. The explicit test action bypasses quiet hours and focus suppression while retaining global enablement and browser permission checks.

The settings provider persists both times in one revision-checked mutation. A stale revision or invalid time rejects the whole mutation. Reset removes user overrides so schema defaults apply again. This plugin is the sole registration owner; the page reads and writes through `ctx.settingsScope`. Removing the owner unregisters the namespace without deleting raw persisted values. The `/types` entry contains only preference data types; runtime defaults live in [the schema](src/settings.ts).

<a id="model-experience"></a>
## Model Experience

None, as the notification namespace registers browser preferences without changing prompts or tool results.

#### KV Cache effect

No model context is added or rewritten, so preference updates do not affect cached request prefixes.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- The Host registration does not call an operating-system notification API; the active client runtime owns delivery for its environment.

<a id="dev-note"></a>
### Dev Note

No invariant companion is published: this package owns one effect-bound schema registration and no independently observed runtime relationship. The [settings ownership decision](../../../.agents/notes/implemented/architecture/2026-09-17-native-settings-runtime-consumers.md) records the quiet-hours semantics and the separation between Host persistence and Client delivery.
