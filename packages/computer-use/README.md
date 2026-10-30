---
description: "Computer Use packages: Service Definition, native providers, permission policy, and tools."
kind: "package-group"
---

# Computer Use

English | [中文](README.zh.md)

## Summary

Local device capabilities compose through the separate device-control profile; ordinary web profiles do not enable device input.
Computer-use providers let models observe and operate a desktop. This group contains the shared registry that prevents multiple providers from being enabled in one composition. DSH's [CUA implementation](../experimental/cua/README.md), platform providers, and opt-in bundle currently live in `experimental`, alongside the Cua Driver adapters. The CUA package documents the platform requirements for promotion to this group.

## Packages

| Package | Role |
|---|---|
| [computer-use](computer-use/README.md) | Service Definition |
| [computer-use-permission-policy](computer-use-permission-policy/README.md) | Permission Consumer |
| [tool-computer-use](tool-computer-use/README.md) | Tool Consumer |

## Related documentation

- [Device control](../../docs/subsystems/device-control.md)
- [Computer use](../../docs/subsystems/computer-use.md) — capability ownership and provider choices.
- [Computer Use bundle](../experimental/cua-bundle/README.md) — enable native CUA and access its permission controls.
- [Experimental packages](../experimental/README.md) — native CUA packages and Cua Driver adapters.

## Dev Note

Platform execution, authentication, and device availability belong to the selected Provider and its deployment environment; package presence does not imply device readiness.
