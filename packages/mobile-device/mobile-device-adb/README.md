---
description: "Native Android ADB observation and input with exact transport targeting."
kind: "package-reference"
---

# @deepseek-ai/dsh-mobile-device-adb

English | [中文](README.zh.md)

## Summary

This provider implements the existing Mobile Device service directly through an installed Android Debug Bridge executable. It supports connected Android phones and emulators; it does not execute Orca, load external application user data, download SDKs, or advertise iOS support.

## Table of Contents

- [Configuration](#configuration)
- [Observation and input](#observation-and-input)
- [Lifecycle and limits](#lifecycle-and-limits)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="configuration"></a>
## Configuration

The Mobile Device service selects provider id `adb`. Set `command` to an existing absolute adb executable or PATH command; otherwise the provider reads the current `mobile-device.androidSdkPath`, accepting an SDK root, a `platform-tools` directory, or an adb executable. An empty saved path uses `adb` on PATH. Each operation captures its executable selection; changing settings cannot redirect its device-file cleanup. Missing or invalid executables fail before input.

| Field | Default | Meaning |
|---|---|---|
| `providerId` | `adb` | Registry id |
| `command` | empty | Existing executable override |
| `cwd` | Host working directory | Subprocess directory |
| `commandTimeoutMs` | 30000 | Per-command deadline, including executable resolution |
| `graceMs` | 3000 | Process-range shutdown grace |
| `cleanupTimeoutMs` | 5000 | Independent device-file cleanup deadline |
| `maxOutputBytes` | 1048576 | Complete text response and observation limit |
| `maxStderrBytes` | 65536 | Diagnostic stream limit |
| `maxImageBytes` | 16777216 | Complete PNG byte limit |
| `maxImagePixels` | 16777216 | Decoded screenshot pixel limit |
| `maxTextBytes` | 4096 | Native input text limit |
| `swipeDurationMs` | 400 | Android swipe duration |

Obtain platform tools from the [official Android SDK platform-tools page](https://developer.android.com/tools/releases/platform-tools). Harness accepts an existing installation and does not redistribute binaries or invent versioned download URLs. SDK `adb version` success proves an executable can run; `adb devices -l` independently reports connected transports. Device discovery may start the standard ADB server, which is not owned or stopped by this provider.

<a id="observation-and-input"></a>
## Observation and input

Device ids are exact `android:<serial>` selectors. Inventory retains offline and unauthorized records as unavailable; an online device requires a valid ADB transport id. Commands target that verified transport with `-t`, never an arbitrary default device. A generation binds executable selection, transport id, and Android boot id. Every mutation consumes the latest observation token before validation and dispatch; retry requires a fresh observation. A provider-local device reservation prevents overlapping observations and inputs.

Observation captures a unique UI hierarchy dump in `/data/local/tmp/dsh-ui-<uuid>.xml`, reads it, and removes it with a bounded cleanup command. It also reads display dimensions, current activity, and optionally raw PNG screenshot bytes. XML is validated with entity expansion disabled; PNG is fully decoded before publication. Coordinates map normalized `0..1` to the observed pixel grid. Input rechecks transport, boot identity, rotation, and display dimensions before dispatch. Android does not expose an atomic observe-and-input transaction; another actor can change content between checks and input.

Native text input accepts ASCII letters, digits, spaces, and `@_.:,/+=-`; spaces use Android input encoding. Unicode, shell syntax, percent escapes, and oversized text fail explicitly without forwarding text. Navigation buttons are `home`, `back`, `power`, `recents`, `enter`, `menu`, `volume_up`, `volume_down`, `tab`, `delete`, and `escape`. App launch, arbitrary shell execution, and package installation are absent from the service.

<a id="lifecycle-and-limits"></a>
## Lifecycle and limits

All commands use Harness subprocess argument arrays, bounded raw stdout and stderr, cancellation, and process-range termination. Failure messages contain fixed error categories rather than ADB stderr or typed text. Disposal rejects new work, aborts commands, attempts owned hierarchy-file cleanup with an independent deadline, and waits for pending operations. A disconnected device or abrupt Host exit can leave the uniquely named hierarchy file; no persistent user files are read or removed.

<a id="model-experience"></a>
## Model Experience

### Existing mobile tools

#### What the model sees

The official Mobile Device tools expose Android inventory, validated hierarchy/current-activity text, optional screenshot attachments, and one-use observation ids. Existing permission-policy classes remain authoritative. Native input limitations return explicit errors; the provider contributes no extra tool or system-prompt registration.

#### Token effect

Observation XML and activity text are bounded by `maxOutputBytes`; screenshots are attached by the tool consumer. Inventory and mutation acknowledgements retain the existing mobile tool format.

#### KV Cache effect

Provider registration and runtime observations do not independently modify the request prefix. The tool consumer owns stable provider-neutral guidance.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- iOS support, emulator installation/boot, Wi-Fi pairing, app management, and Unicode injection are not provided. [Mobile runtime management](../mobile-device-runtime/README.md) owns managed SDK/helper installation and explicit human mirroring; observation never starts scrcpy.
- UI hierarchy availability depends on Android UI Automator and app accessibility; screenshot capture can fail on protected surfaces. Screenshots do not imply a complete or interactive hierarchy.
- Real hardware screenshot and input acceptance requires an authorized connected device. A successful no-device inventory check does not establish those operations.

### Dev Note

No invariant companion is published: exact target, generation, token consumption, byte limits, and process quiescence are enforced by their owning operations. The implementation uses maintained ADB, fast-xml-parser, and Sharp; no donor source or third-party binary is copied into this package.
