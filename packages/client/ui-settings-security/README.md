---
description: "Configure the Mobile Emulator device capability in Settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-security

English | [中文](README.zh.md)

## Summary

One Settings page: the Mobile Emulator. It edits the stored device preferences, reports the provider probe, lists the model-facing mobile tools, and manages Android runtime resources with explicit actions. It installs no software and performs no device input; every install, license acceptance, and mirror start stays an explicit person action with its Host permission checks.

## Table of Contents

- [Use this package](#use-this-package)
- [Settings and action ownership](#settings-and-action-ownership)
- [Dev note](#dev-note)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount with Settings, Locale, and the deviceCapabilities and settings Remotes. The optional pluginManager Remote supplies the entry activation controls the Agent card renders; without it the card reports that management is unavailable and still shows the probe and resource state. The section keeps its navigation entry while the capability is missing. `mobile-registration.ts` owns the scope binding, resource observer, probes, and disposal; `capability-registration.ts` and `capability-shared.ts` hold the section registration and provider-activation callbacks; `CapabilitySection.tsx` renders the page. The assembly contributes the shared locale dictionary and mounts that one feature fiber.

<a id="settings-and-action-ownership"></a>
## Settings and action ownership

| Area | Stored fields and runtime consumers |
|---|---|
| Mobile | The [mobile capability](../../mobile-device/mobile-device/README.md) owns the `mobile-device` namespace. `enabled` controls automatic page checks, `androidSdkPath` supplies Host checks and native ADB operations, and `defaultDeviceId` supplies only an omitted `mobile_observe.device_id`. The page presents Mobile Emulator as one setup card — the check switch, availability with its status badge and re-check, the Android SDK row with its download, use-detected, and clear actions, the custom SDK path, and the default device — followed by an Agent card that tracks the capability entry and the tool entry as two steps with a 0/2 badge, lists the launch command and the `mobile_*` tool names, and offers three copyable example prompts. |
| Runtime resources | The [mobile runtime manager](../../mobile-device/mobile-device-runtime/README.md) owns Platform Tools, scrcpy, and native mirror processes. Each install, reinstall, or update requires explicit license acceptance and the displayed resource revision; removal requires confirmation. Cancel targets the observed task ID. Mirroring requires an explicitly selected available Android device; Close targets the owned mirror ID. A running mirror process does not prove visible pixels. |

Availability and toolchain rows are read-only: the provider probe, the SDK check, and the device listing never write preferences. Only the switch, the SDK path, and the default device join the draft form, and one atomic mutation saves them with the revision read when the draft opened. The page observes the Host only while mounted; `runtimePollIntervalMs` defaults to 1000 ms and accepts 100–60000 ms. Leaving the page stops observation without cancelling a Host task or closing a mirror.

The setup card copies the supported `dsh --profile device-control` command. Clipboard denial displays a failure message.

<a id="dev-note"></a>
## Dev note

The page owns no capability of its own: it projects the mobile capability's stored preferences, the Host device probe, and the runtime manager's resource state. Providers stay independent plugins, so this package can be omitted from a composition without removing the capability.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The custom SDK path is a text field: the page has no native directory picker, so a person types or pastes the path.
- The page reports resource and mirror state the Host publishes; a running mirror process does not prove that pixels reached a display.
