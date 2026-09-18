---
description: "Local CLI Provider with one-use mobile observation tokens."
kind: "package-reference"
---

# @deepseek-ai/dsh-mobile-device-cinlan

English | [中文](README.zh.md)

## Summary

Local CLI Provider with one-use mobile observation tokens.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)

<a id="use-this-package"></a>
## Use this package

This Service Provider implements [`ctx.mobileDevice`](../mobile-device/README.md) through the public Cinlan IDE JSON CLI. Each operation launches one explicit argv through `ctx.subprocess`, validates the complete response, applies bounded stdout, stderr, tree, image, and text limits, and never invokes a shell.

Plugin setup registers the Provider immediately without resolving the executable or probing the device inventory. Executable resolution and the first CLI call happen lazily on the first operation, so a missing or unready Cinlan IDE CLI never blocks the plugin tree. The default executable is `orca` on Windows and macOS and `orca-ide` on Linux; an explicit `command` can select another bare name or absolute path.

## Public commands

| Mobile Device operation | CLI argv after the configured executable |
|---|---|
| `listDevices` | `emulator devices --json` |
| `observe` | `emulator observe --device <deviceId> [--no-screenshot] --json` |
| tap | `emulator tap <x> <y> --device <deviceId> --observation-id <observationId> --json` |
| swipe | `emulator gesture <normalizedGestureJson> --device <deviceId> --observation-id <observationId> --json` |
| `typeText` | `emulator type --text-stdin --device <deviceId> --observation-id <observationId> --json` with literal text on stdin |
| `pressButton` | `emulator button <button> --device <deviceId> --observation-id <observationId> --json` |

The Provider accepts only resolved `MobileObserveSpec` targets. The mobile-device service resolves an omitted Consumer id before calling the Provider; the CLI always receives an explicit `--device`.

## Protocol and freshness

The devices result is a direct array of canonical `{backend,id,name,state,isAvailable,detail?}` records with unique ids. Observations require `protocolVersion: 1`, an opaque `deviceGeneration`, opaque `observationId`, `coordinateSpace: normalized`, bounded tree text, explicit screenshot status, and an optional bounded PNG whose dimensions match its IHDR header. Tap, gesture, type, and button results must be exactly `{ok:true}`.

The outer `_meta.runtimeId` is the Provider generation. Runtime replacement clears all local observations. The Provider retains only the latest observation for each device, consumes it before the runtime probe and mutation dispatch, passes the exact device and observation ids to the CLI, and constructs the public mutation result from that consumed observation after the strict acknowledgement succeeds.

## Model Experience

### Transport-only Provider

#### What the model sees

The Provider contributes no direct model text. It returns tree text and optional PNG bytes for `mobile_observe`; `mobile_type` text never appears in argv or Provider summaries.

#### Token effect

The Provider adds no model tokens by itself.

#### KV Cache effect

CLI execution and observation state do not alter the model request prefix.

## Known Limitations and Deferred Work

- The Provider does not install or launch apps, manage device lifecycle, grant runtime permissions, read logs, transfer files, execute raw commands, expose camera or sensors, use the clipboard, or pair remote devices.
- Real Android and iOS behavior depends on the installed Cinlan CLI and remains outside keyless unit coverage.
- Saved `androidSdkPath` values do not configure this external CLI backend; the Provider exposes no SDK override or guessed environment forwarding.

No runtime invariant companion is published: provider registration, protocol validation, and observation freshness are enforced by their owning operations and covered by the package tests.

Only successful executable lookups are cached. A failed lookup can be retried after installation or PATH repair; caller cancellation and plugin disposal abort an in-flight lookup.

### Dev Note

None.
