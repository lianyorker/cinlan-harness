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
| [mobile-device-adb](mobile-device-adb/README.md) | Native Android Provider |
| [mobile-device-cinlan](mobile-device-cinlan/README.md) | Optional legacy CLI Provider |
| [mobile-device-permission-policy](mobile-device-permission-policy/README.md) | Permission Consumer |
| [tool-mobile-device](tool-mobile-device/README.md) | Tool Consumer |

## Related documentation

- [Device control](../../docs/subsystems/device-control.md)

## Dev Note

The native Provider discovers and controls devices through existing Android platform tools; package presence, executable availability, and device authorization are separate facts.
