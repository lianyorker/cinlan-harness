---
description: "Package map for durable UTC automations that create ordinary Agent Sessions."
kind: "package-group"
---

# automation/ — durable local automations

English | [中文](README.zh.md)

## Summary

The automation group owns saved definitions, occurrence admission, and the invocation journal. Each admitted run creates an ordinary Agent Session with explicit workspace, model, preset, and permission inputs. The [Automation reference](../../docs/subsystems/automation.md) defines shared semantics; package documentation owns configuration and operational limits.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)

<a id="packages"></a>
## Packages

| Package | Responsibility |
|---|---|
| [automation](automation/README.md) | Exclusive local scheduling, durable claims and history, and execution through the existing Agent lifecycle. |

<a id="related-documentation"></a>
## Related documentation

- [Automation API](../api/automation-controller/README.md) provides browser commands and committed-state updates.
- [Automation settings](../client/ui-settings-automation/README.md) provides creation, review, and explicit execution controls.

## Dev Note

This group owns cross-workspace saved automations. Session-local reminders remain owned by the [schedule package](../schedule/schedule/README.md).
