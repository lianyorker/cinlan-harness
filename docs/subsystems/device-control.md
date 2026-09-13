# Device control

English | [中文](device-control.zh.md)

## Composition

The opt-in `device-control` profile layers the [Computer Use bundle](../../packages/bundle/cinlan-computer-use/README.md) and [Mobile Device bundle](../../packages/bundle/cinlan-mobile-device/README.md) over the ordinary base and Web bundles. Generic `web` and `headless` profiles do not acquire device input capabilities. The [user guide](../user/develop/practice/device-control.md) owns launch and configuration instructions.

## Observations and permission

[Computer Use](../../packages/computer-use/computer-use/README.md) names applications, windows, and observation-scoped elements. Actions consume a fresh observation and return the resulting observation. [Mobile Device](../../packages/mobile-device/mobile-device/README.md) uses exact device ids, normalized coordinates, runtime generations, and one-use observation tokens; mutation is followed by an explicit new observation.

The tool Consumers register their schemas and stable model guidance through existing tools and system-prompt services. All observation and action classes default to ask. Execution guards prevent an earlier tool listener from silently bypassing the configured policy. Screenshots use the existing Attachment service; typed input is not echoed in result summaries.

## Runtime readiness

The [readiness controller](../../packages/api/device-capabilities-controller/README.md) owns `deviceCapabilities/check`. It calls the selected desktop Provider's capabilities method or the mobile Provider's device listing; it never sends device input or returns device identities.

| Status | Meaning |
|---|---|
| `not-configured` | The selected service is absent from the active Host |
| `available` | The read-only Provider probe succeeded; mobile also reported an available device |
| `unavailable` | The Provider could not be selected, resolved, or probed, or no mobile device is available |

`reason` is a redacted category, not raw Provider stderr. Loader activation, installation, Provider readiness, and permission to act are distinct facts. The [Settings plugin](../../packages/client/ui-settings-security/README.md) preserves that distinction and shows a usable profile launch command rather than an unsupported installation command.

## Lifecycle

Providers cache only successful executable resolution. A missing CLI can be installed or its PATH repaired, then checked again without restarting the Host. Caller cancellation and plugin disposal interrupt pending executable lookup and command work. CLI failures do not prevent the Settings shell from loading. A missing external CLI is an explicit prerequisite failure, not a stubbed success.
