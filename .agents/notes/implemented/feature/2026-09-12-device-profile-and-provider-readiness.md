# Agent Note: Device profile and Provider readiness

Status: implemented

English | [中文](2026-09-12-device-profile-and-provider-readiness.zh.md)

## Problem

Device settings must distinguish a loaded plugin from a reachable Provider and permission to act. A copied installation command is misleading when the current CLI does not implement it. Desktop and mobile capability sources also need to participate in the current build, tool catalog, profile assembly, and Remote types rather than remain disconnected source copies.

## Decision

Computer Use and Mobile Device retain separate Service Definitions, Providers, policy Consumers, and opt-in bundles. Native CUA owns desktop tool schemas; the native Android ADB Provider retains the official mobile tool Consumer. The device-control profile composes them over the existing base and Web layers; device input requires explicit Provider activation and permission in each deployment. Current ToolCallId, Attachment limits, subprocess handles, and compiler references remain authoritative. Empty invariant installers are not imported.

The deviceCapabilities/check Remote invokes computer readiness or mobile device listing and returns redacted not-configured, available, or unavailable results. Loader status is not an installation probe, and successful readiness does not authorize input. Settings copy the supported dsh profile command and preserve the card layout from the [presentation decision](2026-09-12-computer-use-settings-presentation.md). The [native CUA decision](../architecture/2026-09-20-native-cua-readiness-and-policy.md) owns desktop composition, lifecycle readiness, and native policy. Desktop OS permissions remain unknown; the mobile Provider requires an existing ADB executable and an authorized Android phone or emulator. The [native Android ADB decision](../architecture/2026-09-20-native-android-adb-provider.md) owns exact transport targeting, one-use observations, cancellation, and cleanup; this note remains authoritative for capability separation and readiness.

Native ADB selects the deployment `command` first, then the saved Android SDK root, platform-tools directory, or adb executable, then `adb` on PATH. Missing executables and unavailable devices remain distinct failures. An empty inventory does not prove device control, and iOS is unsupported. SDK installation, emulator boot, and scrcpy management are outside this Provider.

The top-level build invokes native, Host, Client, and Web build steps directly, and records Client artifact hashes only after all steps succeed. A failed phase stops subsequent work. This avoids treating a successful nested package-script wrapper as evidence that its child builds actually ran.

Security Research has an independent read-only Remote over existing Host services, Loader activation, and Skill discovery. Its configured result means configuration completeness only; inactive entries, invalid presets, incomplete catalogs, and empty execution-host grants cannot imply operational readiness. Runtime-loaded preset directories, skill assets, and sidebar viewer chunks remain explicitly included in the publication policy.

## Alternatives considered

Enabling device input in every Web profile would silently broaden existing deployments. A dedicated opt-in profile keeps the original composition and explicit ask policies.

Using Loader activation as an installed badge would hide missing executables and unavailable mobile devices. A read-only Provider probe gives operational evidence without exposing application content or device identities.

Restoring the old Client runtime or alternate application launcher would replace current ownership. Existing Cordis services, Typert Remotes, Settings slots, and the dsh launcher supply the required extension points.

## Consequences

The profile exposes real device tools with freshness and approval enforcement. It does not install external software, grant native permissions, or prove every device action will work. Settings remain usable when Providers are absent or fail. The previous card-only installation claim is superseded by Provider readiness, while its layout and localized controls remain.

## Verification

Provider, parser, tool, policy, and Loader-composition tests cover allowed and denied observations, stale identifiers, screenshots, cancellation, disposal, and retry after executable repair. A source-CLI profile test verifies both bundles and all ask-by-default policies. Component tests and a real Web Host/Chromium scenario verify localized status, command copying, refresh through the generated Remote, and the absence of installed claims. These fixtures do not establish real device input. Native Android acceptance includes 199 passing focused tests and a separate real ADB 37.0.0 version/inventory run with zero devices; hierarchy, screenshot, and input on hardware remain unverified.
