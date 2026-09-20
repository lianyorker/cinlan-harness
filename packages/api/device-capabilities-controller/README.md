---
description: "The deviceCapabilities/check Remote probes optional Computer Use or Mobile Device Providers without installing software or performing input. It returns redacted readiness categories rather than Loader activation or installation claims."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-device-capabilities-controller

English | [中文](README.zh.md)

## Summary

The deviceCapabilities/check Remote probes optional Computer Use or Mobile Device Providers without installing software or performing input. It returns redacted readiness categories rather than Loader activation or installation claims.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount this controller with the Typert registry. Computer Use and Mobile Device services are optional; missing services return not-configured. Computer checks call `readiness(signal)`; mobile checks call listDevices and return no-devices when no available device is reported. Neither response contains application names, device ids, command paths, or Provider error text.

The optional `computer` response is discriminated by `kind`. `tool-catalog` returns provider, platform, lifecycle state, readonly tool names, and `permissions: unknown`; `ready` is available, and the native provider publishes it only with a nonempty catalog. Other states report `provider-initializing`, `provider-disposing`, or `provider-failed`. `facade` retains the flat platform, provider, providerVersion, protocolVersion, supports, and permissions fields. Neither variant invents a CUA action capability descriptor.

The `checkSdk` Remote runs `adb version` and, on macOS, `xcrun simctl help` through the mounted subprocess provider. A nonempty saved `mobile-device.androidSdkPath` selects its absolute `platform-tools/adb` executable (`adb.exe` on Windows); a failed configured path never falls back to another SDK. An empty path searches `ANDROID_HOME`, `ANDROID_SDK_ROOT`, and conventional SDK locations. A successful check requires zero exit, no terminating signal, and complete bounded output. Missing executables, launch failures, failed exits, output overflow, and timeout report unavailable without exposing process output. Caller cancellation propagates after managed process ranges are drained; controller disposal aborts and joins outstanding checks.

| Config field | Default | Meaning |
|---|---:|---|
| `probeTimeoutMs` | 5,000 | Shared deadline for executable lookup and commands in one SDK check |
| `probeGraceMs` | 1,000 | Managed termination and output-drain grace |
| `maxProbeOutputBytes` | 65,536 | Maximum retained bytes per stdout or stderr stream |

All bounds are positive integers no greater than 2,147,483,647. Deadline expiry requests termination; the request settles after process cleanup. A missing subprocess provider reports SDKs unavailable. The separate `listMobileDevices` Remote performs Provider enumeration and returns only device id, name, state, and availability; it does not observe or control a device.

<a id="model-experience"></a>
## Model Experience

None, as this controller registers no model tools, prompts, or Session events.

#### KV Cache effect

None; readiness does not enter model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Readiness reports catalog lifecycle or a facade probe at one point in time; it does not authorize actions or verify OS grants. Native CUA permissions stay unknown, and its packaged SDK does not require an external CLI. Facade transports retain their own prerequisites. Caller cancellation propagates to the Provider.
- The saved SDK path controls local SDK checks only. The external Cinlan device runtime has no supported SDK override in the public CLI used by the Mobile Device Provider; SDK checks do not configure that runtime.

No runtime invariant companion is published: the controller returns immediate results and retains no independent Provider state.

### Dev Note

Status definitions live in [types.ts](src/types.ts).
