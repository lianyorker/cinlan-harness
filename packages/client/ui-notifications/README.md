---
description: "Configure completion and tool-result bell notifications, sounds, focus quieting, and daily do-not-disturb hours."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-notifications

English | [中文](README.zh.md)

## Summary

Choose desktop alerts for agent completion and bell characters in new tool results. Notification preferences persist on writable loopback hosts. Focus quieting and daily do-not-disturb hours suppress automatic alerts and their sounds. Send a real test notification to request browser permission and check delivery.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the preference owner and this page in a Web client composition that provides settings, locale, slots, and sessions:

```yaml
- name: '@deepseek-ai/dsh-notifications'
- name: '@deepseek-ai/dsh-client-ui-notifications'
```

The page groups desktop notifications, do-not-disturb hours, and sounds into rows. It exposes global enablement, completion alerts, tool-result bells, focus quieting, a daily quiet interval, sound selection, custom audio, and a test action. The [notification schema](../../notifications/notifications/src/settings.ts) owns the stored fields and defaults; only the separately mounted notification plugin registers it, so reloading this page cannot recreate an unmounted namespace; enabling preferences does not grant browser permission.

Edits use the `notifications` namespace. Loading, unavailable, and read-only settings disable editing. A rejected write restores the accepted Host value and offers an explicit retry. Restore defaults atomically removes all notification overrides, including overrides equal to inherited values and the quiet interval, so the Host can resolve defaults again.

Scheduled do not disturb defaults to off, with a `22:00`–`08:00` interval. It uses the browser's current local time, includes the start, and excludes the end. An interval can cross midnight; equal times mean all-day quieting. Suppressed alerts and sounds are discarded, with no catch-up delivery. Edit both times and choose **Save quiet hours** to commit them together; the draft retains its starting revision, and an explicit retry uses the recovered Host revision.

The test action bypasses focus quieting and scheduled do not disturb, respects global enablement, and requests browser permission when needed. Background events require permission already granted. Delivery failure leaves preferences unchanged and displays guidance to check notification support and permissions.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [client plugin](src/client/index.ts) registers its personal-preferences section and localized search items in the same slot declaration lifetime. The renderer binds the settings source to a hook; components receive explicit commands. Search indexes public labels, descriptions, and keywords, never settings values or custom filenames. Every item has an always-mounted navigation anchor.

The [delivery runtime](src/client/runtime.ts) sends a completion alert for an observed `api-session/status` running-to-idle edge and clears that observation on connection reset. It sends a bell alert for a newly appended `tool/result` containing BEL (`\u0007`); history replacement and paging produce no alerts. Delivery reads current enablement, focus, local quiet hours, and sound preferences, and rechecks them after asynchronous permission handling. Plugin disposal removes listeners and revokes custom audio URLs.

For changed overrides, the [preference commands](src/client/settings-actions.ts) require Host acceptance and matching effective values plus explicit user overrides. Existing matching overrides need no write; reselecting the same custom filename attaches new audio bytes to this browser runtime. Reset confirms removal of owned overrides. The shared settings scope owns serialized writes, revision checks, and conflict recovery. A refused write still reports failure when recovery finds equal values committed by another writer.

No runtime invariant companion is published: this package consumes the settings and Session owners' snapshots and owns no independently replicated business state.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as notification controls and delivery do not change model requests, tools, or Session records.

#### KV Cache effect

None. Notification preferences do not enter model input or KV cache.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

Notification delivery depends on the current browser and its granted system permissions.

- Custom audio bytes last for the current page runtime; only the filename persists. Reloading requires selecting the file again, and browser autoplay policy can prevent sound playback.
- Terminal bell alerts consume BEL in new tool results, not raw interactive terminal streams. Completion means an observed running-to-idle transition and does not distinguish successful completion from cancellation or failure.
- Quiet hours follow the current browser's clock and timezone, including local daylight-saving changes. Different devices can enter the shared interval at different moments. Volume and a separate sound-enable preference are not exposed.
- Browser notification support and operating-system policies determine delivery and the system-default sound. A successful test confirms that the browser accepted the notification, not that the operating system displayed or sounded it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Current component and real-composition acceptance evidence, with remaining verification, is tracked in the [acceptance status](../../../.agents/plans/settings-native-acceptance-status.md).

</details>
