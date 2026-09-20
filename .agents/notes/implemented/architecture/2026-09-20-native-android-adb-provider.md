# Agent Note: Native Android ADB provider

Status: implemented

English | [中文](2026-09-20-native-android-adb-provider.zh.md)

## Problem

Mobile Device needs local Android observation and input without depending on another application runtime, cloud account, or user-data directory. A successful SDK probe does not establish an authorized connected device, and a recycled ADB transport must not inherit a prior observation token.

## Decision

The native ADB provider implements the existing Mobile Device service and keeps its official tools and permission-policy Consumer. The mobile bundle selects provider id adb. Device ids identify exact Android serials; commands target the verified transport id. A generation binds executable selection, transport id, and Android boot id. Mutations consume one observation token and recheck identity and display geometry before input. Changing devices never falls back to another connected target.

All execution uses Harness subprocess argument arrays with per-command deadlines, complete stdout limits, bounded stderr, cancellation, and process-range joining. Observation owns a uniquely named device-side hierarchy file and a separately bounded cleanup attempt. An operation captures its executable selection so a concurrent settings change cannot redirect cleanup. Typed text and raw ADB failures do not appear in error summaries.

The provider accepts an existing official Android platform-tools installation through deployment command configuration or the saved SDK path. It neither distributes binaries nor invents an installer source. Windows exposes Android only; iOS, emulator boot, SDK lifecycle, and scrcpy mirroring remain separate unimplemented capabilities. The Web settings and model guidance distinguish executable availability from authorized device availability.

## Alternatives considered

**Keep an external application CLI as the default.** That makes independent Harness deployment depend on another runtime and its configuration. The native provider invokes ADB directly.

**Target a serial without transport generation.** Reconnection can associate stale observations with a changed device instance. Transport id and boot identity are revalidated; Android still cannot provide atomic observation-and-input semantics.

**Pass arbitrary text to adb shell input.** ADB reconstructs remote shell command text, and Android input does not universally support Unicode. The native provider accepts a documented literal-safe ASCII alphabet, encodes spaces, and rejects unsupported input rather than reporting success after alteration.

**Parse screenshots with only a PNG signature.** Full decoding with Sharp catches invalid image data and bounds pixels; a fixed IEND marker check also rejects a missing trailer that the decoder accepts. XML uses the maintained fast-xml-parser with external declarations and entity expansion disabled.

## Consequences

Physical phones require USB debugging and explicit host authorization. Device discovery can start the shared ADB server, which the provider does not stop. Protected screenshots or unavailable accessibility trees can fail. Device disconnect or abrupt Host exit can leave the uniquely named hierarchy file; normal cancellation attempts cleanup without using the cancelled caller signal. No donor code or binary is copied.

The [device profile/readiness decision](../feature/2026-09-12-device-profile-and-provider-readiness.md) remains active for capability separation and profile composition; this record partially replaces its mobile CLI realization. The [native settings resolution decision](2026-09-17-native-settings-runtime-consumers.md) remains authoritative for exact saved-default selection.

## Verification

Protocol tests cover unavailable devices, malformed identities and XML, dimensions, activity, and complete PNG validation. Runner tests cover byte limits, late executable resolution, cancellation, disposal, cleanup failures, and executable pinning. Provider tests reject stale boot/transport/geometry and unsupported input. A real Loader test executes controlled external ADB command fixtures through the actual Harness subprocess service and official mobile tools, including permission denial and one-use token consumption; it is not hardware acceptance. An opt-in real installed-ADB test records version and inventory only. Empty inventory leaves real screenshot/input acceptance explicitly unavailable.
