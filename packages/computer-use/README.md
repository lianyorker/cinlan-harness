---
description: "Computer Use packages: Service Definition, native providers, permission policy, and tools."
kind: "package-group"
---

# Computer Use

English | [中文](README.zh.md)

## Summary

Local device capabilities compose through the separate device-control profile; ordinary web profiles do not enable device input.

## Packages

| Package | Role |
|---|---|
| [computer-use](computer-use/README.md) | Service Definition |
| [computer-use-permission-policy](computer-use-permission-policy/README.md) | Permission Consumer |
| [tool-computer-use](tool-computer-use/README.md) | Tool Consumer |

## Related documentation

- [Device control](../../docs/subsystems/device-control.md)

## Dev Note

Platform execution, authentication, and device availability belong to the selected Provider and its deployment environment; package presence does not imply device readiness.
