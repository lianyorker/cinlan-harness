---
description: "Provider-neutral mobile device registry and observation/input requests."
kind: "package-reference"
---

# @deepseek-ai/dsh-mobile-device

English | [中文](README.zh.md)

## Summary

Provider-neutral mobile device registry and observation/input requests.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)

<a id="use-this-package"></a>
## Use this package

This Service Definition owns the provider-neutral `ctx.mobileDevice` registry and execution facade. Providers own device discovery, exact device identity, runtime generations, observation tokens, tree text, optional validated PNG bytes, and mutations; Consumers own permission policy, model schemas, attachment persistence, and presentation.

## Provider selection

The optional `provider` config pins one Provider id. Without it, each call selects exactly one available Provider. Missing, unavailable, absent, ambiguous, blank, and duplicate Providers fail with structured `MobileDeviceError` codes rather than selecting implicitly.

## Saved preferences

The capability owns the optional settings namespace `mobile-device`. `getPreferences()` returns current resolved `enabled`, `defaultDeviceId`, and `androidSdkPath` values; without a settings service their defaults are `false`, `''`, and `''`. Registration leaves with the capability or settings service. These preferences do not grant input permission or activate a Provider. Browser Consumers import `MobileDeviceSettings` type-only from `@deepseek-ai/dsh-mobile-device/types`.

Observation requests may omit `deviceId`. The service captures one Provider and preferences value, then requires exactly one currently available inventory record matching the saved default. An explicit nonblank id bypasses default selection. A missing, invalid, ambiguous, or unavailable default fails; discovery or observation failure never substitutes another device. Providers receive a `MobileObserveSpec` with a required exact id, and mutations still require explicit device and observation ids.

## Identity and observations

`MobileDeviceId` is an opaque exact selector. `MobileDeviceGeneration` identifies one Provider-reported device instance, and `MobileObservationId` is an opaque one-use token. Every mutation requires the exact device and latest observation ids; the Provider consumes the token before dispatch, and callers must observe again after success or failure.

Touch requests use normalized coordinates from `0` through `1`. The service exposes only device listing, observation, tap or swipe, literal text input, and device navigation buttons.

## Model Experience

### Consumer-owned results

#### What the model sees

This package contributes no model text. [`@deepseek-ai/dsh-tool-mobile-device`](../tool-mobile-device/README.md) renders results and preserves `MobileDeviceError` failures through the ordinary tool-result path.

#### Token effect

The Service Definition adds no request or result tokens; the model-facing Consumer owns those costs.

#### KV Cache effect

Provider registration, selection, and observation state do not alter the model request prefix.

## Known Limitations and Deferred Work

- The service has no durable device record, remote pairing, Execution Host binding, or emulator lifecycle ownership.
- `androidSdkPath` is a saved local SDK probe preference, not a supported SDK override for the external Cinlan device backend.
- The initial API excludes application management, runtime permissions, logcat, file transfer, raw execution, camera, sensors, clipboard, and device boot or shutdown.

No runtime invariant companion is published: provider registration, protocol validation, and observation freshness are enforced by their owning operations and covered by the package tests.

### Dev Note

None.
