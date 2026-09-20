# Local device control

English | [中文](device-control.zh.md)

## Summary

Use the `device-control` profile to inspect and operate desktop windows or an authorized Android phone or emulator through Harness tools and approval. Desktop control uses native CUA; mobile control uses an existing Android ADB installation.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Start the profile](#start-the-profile)
- [Select Android tools and a device](#select-android-tools-and-a-device)
- [Verify readiness](#verify-readiness)
- [Limits](#limits)

<a id="prerequisites"></a>
## Prerequisites

Use a build containing the device-control profile. [Native CUA](../../../../packages/experimental/computer-use-cua-driver-native/README.md) requires its packaged native dependency, a graphical desktop session, and the launching application’s OS permissions; it does not require an Orca application or CLI.

Android control requires existing [official platform tools](https://developer.android.com/tools/releases/platform-tools) and an online, authorized Android phone or emulator. A physical phone requires USB debugging and authorization for this Host. Offline and unauthorized devices remain unavailable. This provider does not support iOS.

<a id="start-the-profile"></a>
## Start the profile

Inspect the composition without requesting device input or a model response:

```sh
dsh --profile device-control --dump-config
```

Start its Web interface:

```sh
dsh --profile device-control
```

The profile uses the normal Harness launcher and includes the native Computer Use and Mobile Device bundles. Starting the profile does not install Android tools or grant input permission.

<a id="select-android-tools-and-a-device"></a>
## Select Android tools and a device

In Mobile device settings, the saved Android SDK path accepts an absolute SDK root, a `platform-tools` directory, or an `adb` executable. A configured provider `command` takes precedence over this saved path; when both are empty, the provider uses `adb` on PATH. The [native ADB README](../../../../packages/mobile-device/mobile-device-adb/README.md) owns deployment configuration and execution limits.

Select an exact `android:<serial>` device. The saved default is used only when an observation omits its target; a missing, ambiguous, or unavailable default never selects a different device. The provider verifies the device transport before input.

<a id="verify-readiness"></a>
## Verify readiness

Open Settings → Computer use or Mobile device and check readiness. A ready desktop tool catalog does not prove OS access or grant approval. A successful ADB executable check does not prove a connected device; mobile readiness also requires an available device. No devices means device control is unavailable. Discovery can start the shared ADB server.

Native desktop tools and all mobile observation/input classes request approval by default. Observe the exact target before acting and verify fresh state afterward. Mobile mutations consume a one-use observation token, so obtain a new observation before another input or retry.

<a id="limits"></a>
## Limits

The Android provider does not install or boot emulators, manage SDK downloads or versions, or launch scrcpy mirroring. SDK and mirroring management require separate implementation. Native text input has a restricted literal-safe ASCII alphabet; unsupported text fails explicitly. See the [provider limits](../../../../packages/mobile-device/mobile-device-adb/README.md#known-limitations-and-deferred-work).

A successful no-device inventory check does not verify hierarchy capture, screenshots, or input on hardware. Validate those operations on an authorized target before relying on them. [Device control](../../../subsystems/device-control.md) explains readiness and lifecycle semantics.
