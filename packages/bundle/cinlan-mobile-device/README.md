---
description: "Mobile Device profile bundle with approval required by default."
kind: "package-bundle"
---

# @deepseek-ai/dsh-cinlan-mobile-device

English | [中文](README.zh.md)

## Summary

Mobile Device profile bundle with approval required by default.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)

<a id="use-this-package"></a>
## Use this package

This bundle exports `cordis.patch.yml` for the complete Cinlan Mobile Device capability family. A profile applies it once after `dsh-base`; the shipped Web and Desktop compositions include it. Custom profiles, including headless profiles, can select it explicitly.

The patch mounts the provider-neutral Service Definition, native resource manager, native Android ADB Provider, permission-policy Consumer, and five model tools. It pins Provider id `adb` and configures `observe`, `touch`, `textInput`, and `deviceNavigation` as `ask`. Mounting installs no Android resources and starts no mirror; those require explicit human actions. The [Mobile Device preferences](../../mobile-device/mobile-device/README.md#saved-preferences) update live through Settings.

## Model Experience

### Profile composition

#### What the model sees

Once approved by policy, the model receives the Mobile Device guidance and five `mobile_*` schemas. Without this patch, none of those tools or prompt sections exist.

#### Token effect

Enabling the bundle adds the tool Consumer's stable guidance and schemas plus per-call results.

#### KV Cache effect

The bundle changes the request prefix for profiles that select it; its fixed patch order is stable across sessions.

## Known Limitations and Deferred Work

- The bundle requires an existing Android ADB installation and authorized devices; it supports physical Android phones and emulators, not iOS. See the [native ADB Provider](../../mobile-device/mobile-device-adb/README.md) for SDK selection, input, and cleanup limits.

No runtime invariant companion is published: provider registration, protocol validation, and observation freshness are enforced by their owning operations and covered by the package tests.

### Dev Note

None.
