---
description: "Mobile Device packages: Service Definition, CLI Provider, permission policy, and tools."
kind: "package-group"
---

# Mobile Device

English | [中文](README.zh.md)

## Summary

Local device capabilities compose through the separate device-control profile; ordinary web profiles do not enable device input.

## Packages

| Package | Role |
|---|---|
| [mobile-device](mobile-device/README.md) | Service Definition |
| [mobile-device-cinlan](mobile-device-cinlan/README.md) | Provider |
| [mobile-device-permission-policy](mobile-device-permission-policy/README.md) | Permission Consumer |
| [tool-mobile-device](tool-mobile-device/README.md) | Tool Consumer |

## Related documentation

- [Device control](../../docs/subsystems/device-control.md)

## Dev Note

Platform execution, authentication, and device availability belong to the external CLI; package presence does not imply device readiness.
