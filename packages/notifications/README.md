---
description: "Host-owned notification preferences consumed by the active Client."
kind: "package-group"
---

# notifications/ — notification preferences

English | [中文](README.zh.md)

## Summary

The `notifications/` group owns the durable notification settings namespace. Browser permission, sound playback, and notification delivery belong to the active Client.

## Table of Contents

- [Package](#package)
- [Related documentation](#related-documentation)

<a id="package"></a>
## Package

| Package | Role |
|---|---|
| [notifications/](notifications/README.md) | Host registration and validation of notification preferences, including quiet hours |

<a id="related-documentation"></a>
## Related documentation

- [Settings subsystem reference](../../docs/subsystems/settings.md) — namespace registration, persistence, and revision-checked writes.
- [Notification Settings and delivery](../client/ui-notifications/README.md) — browser permissions, automatic alerts, and explicit tests.
