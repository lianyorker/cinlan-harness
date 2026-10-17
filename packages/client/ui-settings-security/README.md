---
description: "Configure the Mobile Emulator device capability in Settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-security

English | [中文](README.zh.md)

## Summary

Mobile Companion is a shared Desktop/Web workbench panel with a left-sidebar entry after Automation Tasks and before Workspaces. Its workbench entry provides a three-step guide (Get the app, Pair phone, Paired). The authenticated Host owns the machine name, connection method, LAN address, Director URL, and region, and generates time-limited `cinlan://pair` QR/link offers. Mobile Emulator remains a separate settings page for device preferences, probes, commands, and example prompts.

## Table of Contents

- [Use this package](#use-this-package)
- [Settings and action ownership](#settings-and-action-ownership)
- [Dev note](#dev-note)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

The Companion page owns local presentation visibility: the toggle updates the shared sidebar entry. The Host owns machine name, transport, and relay status; the browser renders a QR only after the Host returns a valid pairing offer. Relay status is shown as connecting, connected, or disconnected. The paired-device list is Host-backed, and revoke requests immediately disconnect the selected device.

-----

<a id="use-this-package"></a>
## Use this package

Mount with Settings, Locale, and the deviceCapabilities and settings Remotes. `companion-registration.ts` registers the Mobile pairing page; `mobile-registration.ts` owns the Mobile Emulator scope binding and probes. The page does not render plugin activation or Android resource controls.

<a id="settings-and-action-ownership"></a>
## Settings and action ownership

| Area | Stored fields and runtime consumers |
|---|---|
| Mobile | The [mobile capability](../../mobile-device/mobile-device/README.md) owns the `mobile-device` namespace. The configured `enabled` value controls automatic page checks and is preserved rather than edited by this page. `androidSdkPath` supplies Host checks and native ADB operations, and `defaultDeviceId` supplies only an omitted `mobile_observe.device_id`. Setup contains availability, Android SDK controls, and default device, followed by supported commands and copyable example prompts. |

Availability and toolchain rows are read-only. The SDK path and default device save on blur using the draft's opening revision. Writes are serialized; a queued edit uses the preceding accepted revision. Failures retain the draft for retry. Leaving the page cancels checks and abandons queued writes without undoing a write already sent to the Host.

Download Android Studio links to `https://developer.android.com/studio`. Locate SDK folder uses the composed `directory.picker` Factory: Browse opens the existing in-app directory browser, and Native uses the Desktop preload bridge or Host chooser. Confirming a folder, adopting the detected path, or clearing the path saves immediately; cancellation preserves the draft. Saved SDK changes refresh the checks. Open folder uses the optional Session Remote to open the detected directory or reveal its ADB executable; unsaved paths are not offered. Read-only connections retain refresh and opening but cannot change preferences.

Commands include `dsh --profile web` and the `mobile_*` tools. Clipboard denial displays a failure message.

<a id="dev-note"></a>
## Dev note

The page projects stored preferences and Host probes; omitting it does not remove the underlying capability or alter operation approvals.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Pickerless compositions retain manual SDK path entry. Native folder opening requires the Session Remote and a verified local Host path.
