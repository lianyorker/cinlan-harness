---
description: "Managed Android platform-tools and scrcpy with private storage and explicit human actions."
kind: "package-reference"
---

# @deepseek-ai/dsh-mobile-device-runtime

English | [中文](README.zh.md)

## Summary

The Host manages fixed official Android platform-tools and scrcpy releases independently from Mobile Device tool activation. Settings can install, reinstall, update to a newer reviewed catalog release, remove managed files, and open or close an exact-device mirror. The manager contributes no model tool.

## Table of Contents

- [Resources](#resources)
- [Configuration](#configuration)
- [Execution and ownership](#execution-and-ownership)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="resources"></a>
## Resources

The catalog pins Android platform-tools 37.0.1 and scrcpy 4.1 for Windows x64. Release URLs, sizes, SHA-256 digests, and upstream license links are fixed in the catalog. Google's repository SHA-1 was checked against the downloaded archive before recording its SHA-256; scrcpy's SHA-256 comes from the official GitHub release API. Newer releases require a reviewed catalog update. Installation requires explicit acceptance of the linked upstream license. Archives retain upstream files and notices; Harness does not publish bundled third-party binaries.

Downloads enter private staging, enforce the exact complete size and digest, reject unsafe archive paths and links, and run a bounded native version probe before publication. A durable revision guards atomic replacement. Cancellation or failure before publication preserves the previous generation; publication wins a concurrent cancellation once its commit starts. Closing Settings stops observation, not a Host-owned installation. Cancellation targets the exact task receipt.

Managed resource generations live under the configured private storage directory. Full-file SHA-256 inventory verification precedes execution. Cross-Host lease files prevent replacement or removal while executables are in use. Leases are never guessed stale or removed by another Host; recovery from a crashed owner requires operator verification. Removal retires only owned managed generations and reports cleanup failure if the OS retains a loaded binary. It never deletes custom SDK paths or kills the shared ADB server.

<a id="configuration"></a>
## Configuration

| Field | Default | Meaning |
|---|---|---|
| `storageDir` | Harness home/mobile/runtime | Private immutable component storage |
| `commandTimeoutMs` | 10000 | Version and connection probe deadline |
| `installTimeoutMs` | 600000 | Complete installation deadline |
| `processGraceMs` | 3000 | Owned process-range exit grace |
| `maxOutputBytes` | 65536 | Probe output limit per stream |
| `maxExpandedBytes` | 268435456 | Complete ZIP expansion limit |
| `maxArchiveFiles` | 1024 | ZIP entry count limit |
| `lockWaitMs` | 3000 | Cross-Host storage lock wait |
| `mirrorPollMs` | 1000 | Exact connection identity recheck interval |
| `downloadProxyUrl` | empty | Explicit HTTP(S) proxy; system proxy settings are not imported |

ADB selection is explicit Provider command, then the saved SDK root/platform-tools directory/adb path, then a verified managed platform-tools executable, then PATH. The native ADB Provider holds the selected managed generation through its complete operation and device-file cleanup. SDK checks use the same selection. A custom SDK remains authoritative after managed installation.

<a id="execution-and-ownership"></a>
## Execution and ownership

Remote resource and mirror management requires an authenticated trusted-local Gateway caller; absent or delegated authority is rejected before operation dispatch. Resource state, executable version, and authorized device connections are independent facts. Offline or unauthorized devices cannot start a mirror.

An explicit human mirror request selects an exact Android serial and verifies its transport and boot identity. Harness starts scrcpy with pinned `ADB` and server paths, audio and device control disabled, and holds both executable leases until its process range exits. Connection monitoring closes the owned process when transport or boot identity changes. A mirror receipt identifies only that owned process; closing it never stops another scrcpy or the shared ADB server. A running process does not prove that pixels rendered successfully.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the existing Mobile Device tools whose Provider consumes the selected ADB executable; resource and mirror controls belong to local human Settings.

#### KV Cache effect

Resource status, download progress, and mirror receipts do not enter model requests; existing observations retain their format and provider-neutral guidance.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Managed installation currently supports Windows x64 only. Existing custom ADB remains available through the Provider on its supported platforms. iOS runtime management is unsupported.
- Emulator images, emulator boot, Wi-Fi pairing, application installation, and mobile remote access are separate capabilities. This manager does not install large emulator images or connect unknown devices.
- Android requires USB debugging and explicit device authorization. Real mirror display and input acceptance require a connected authorized device; empty inventory is not device acceptance.
- Android offers no atomic transport-to-scrcpy launch transaction. Identity is checked before launch and monitored while running; another local actor can affect the device between checks.
- An OS-loaded ADB binary or orphaned lease can prevent removal. The manager reports failure and preserves ownership metadata rather than terminating an external shared daemon.

### Dev Note

No invariant companion is published: storage revision checks, verified inventories, executable leases, and subprocess settlement are enforced by their owning operations. ZIP decoding uses yauzl; atomic publication uses the existing Harness atomic-write primitive.
