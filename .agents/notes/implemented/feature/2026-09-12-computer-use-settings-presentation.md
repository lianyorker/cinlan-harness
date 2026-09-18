# Agent Note: Computer Use settings presentation migration

Status: implemented

English | [中文](2026-09-12-computer-use-settings-presentation.zh.md)

## Problem

The Settings shell exposed a generic Computer Use Loader inventory page, while the product reference requires an actionable capability presentation: capability state, a copyable CLI command, and concise guidance for observation, desktop actions, and verification.

## Decision

The card layout, copy control, and usage guidance remain in ui-settings-security. Status sourcing and profile activation are owned by the [device readiness decision](2026-09-12-device-profile-and-provider-readiness.md); Loader activation is not an installation claim. Security Research and Design share the icon, hero, and guidance-card hierarchy. Browser and Mobile Emulator use ordered setup cards, and Loader diagnostics stay collapsed below the product guidance.

Computer observations come from the device readiness response: platform, Provider and protocol versions, and declared support. Missing or failed reads do not reuse older observations. Permissions remain `unknown`; a successful descriptor read does not establish action authorization. The page neither probes nor changes operating-system permissions.

## Alternatives considered

A separate Computer Use settings package would isolate the feature but would duplicate the capability roster and split the existing Settings integration. Reusing the current `ui-settings-security` package keeps registration, inventory reads, and localization in one owner.

Adding installation or permission mutations to the browser page would make the UI a second policy owner. The page therefore keeps the command informational and leaves execution to Host/CLI services.

## Consequences

The Computer Use page now matches the Settings visual language: hairline borders, restrained neutral surfaces, semantic theme aliases, compact controls, and responsive cards. Copy feedback is local to the control and uses the shared clipboard helper. A missing or failed Host inventory remains visible without hiding the installation guidance.

## Verification

Component tests and the real Web device readiness scenario cover the current cards. The [readiness decision](2026-09-12-device-profile-and-provider-readiness.md) owns native-device verification limits.

## Deferred

Mobile Emulator means Agent control of a device, not a mobile client connecting back to Harness. SDK detection and default-device preferences use their [native settings owners](../architecture/2026-09-17-native-settings-runtime-consumers.md); browser Cookie import uses the [native Browser operations](2026-09-13-native-browser-operations.md). These operations do not install software or grant device permissions. Computer selection and operating-system permission controls remain unavailable. Design Studio installation versus replacement remains undecided; the installed design Skill is guidance, not proof of a Design Studio Provider. GitHub publishing and downloadable dependency closure require a separate release implementation.
