---
description: "Pinned local speech models with Host tasks, verified generations, and native recognition."
kind: "package-reference"
---
# Sherpa voice provider

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-voice-sherpa-onnx` mounts local `sherpa-onnx-node` recognition and model management on `ctx.voice`. It requires `voice` and managed `subprocess`; a Web server is optional. The [pinned catalog](src/model-registry.ts) contains six models with archive or per-file SHA-256 checksums.

## Table of Contents

- [Configuration](#configuration)
- [Resource lifecycle](#resource-lifecycle)
- [Transports and native recognition](#transports-and-native-recognition)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="configuration"></a>
## Configuration

Mount this plugin alongside the [Voice runtime](../voice/README.md). The following fields are validated at load; byte counts, durations, concurrency, and attempts must be positive safe integers.

| Field | Default | Purpose |
|---|---|---|
| `cacheRoot` | `$DSH_HOME/models/voice` | Absolute storage root captured at mount |
| `downloadSegmentBytes` | 8 MiB | Archive range size |
| `downloadConcurrency` | 4 | Concurrent archive range requests |
| `downloadMaxAttempts` | 4 | Attempts per range or file |
| `downloadRetryDelayMs` | 1,000 | Initial exponential backoff |
| `downloadRequestTimeoutMs` | 120,000 | Maximum interval without response bytes |
| `resourceLockTimeoutMs` | 10,000 | Maximum cross-Host lock wait |
| `resourceLockRetryMs` | 25 | Lock retry interval |
| `extractionGraceMs` | 5,000 | Managed tar termination grace |
| `extractionStderrBytes` | 65,536 | Retained tar diagnostics |

<a id="resource-lifecycle"></a>
## Resource lifecycle

Download, reinstall, and update return a Host task immediately. Repeated admission while that model has a running task returns the same identity. Disconnecting a client does not cancel it. Exact cancellation joins the matching task and retains the installed generation; stale and foreign-Host identities cannot cancel replacement work. Provider disposal withdraws operations, then cancels and joins only its own tasks and recognizers. Task progress and terminal errors belong to the mounted Host and reset on provider reload.

Versions are `sha256:` fingerprints of the pinned download manifest and recognizer configuration. They do not claim an upstream release or perform upstream version discovery. Resource rows include installed and available fingerprints, sanitized source URLs, integrity state, and a durable revision. A ready old generation remains usable during replacement and after a failed or cancelled replacement. Task errors contain stable codes and safe messages.

Transfers use task-private staging. Sized archives use concurrent ranges with bounded retry and idle timeout; servers that ignore ranges may return the whole archive. Individual files use the same retry and timeout settings and require their exact pinned size and SHA-256. The archive hash is checked before managed native tar extraction. Completed task staging and transfer parts are removed after settlement; cross-task resume is not provided.

The store records a required-file hash inventory and an immutable generation under `.resources/<modelId>`. Inspection and recognizer acquisition verify those bytes. Publication compares the revision observed at task admission, renames prepared staging within the writer lock, and atomically replaces the pointer. Removal writes a fresh revision tombstone, including when already absent, so an older task cannot republish after removal. A failed transfer, validation, or revision comparison leaves the active pointer intact.

Recognizers acquire persistent generation leases under the same lock as publication and collection. Replacement and removal collect only inactive generations without live or unknown owners; a recognizer releases its lease after native disposal. Definite dead-process leases may be reclaimed. Unknown owners, foreign-machine leases, and potentially reused process IDs retain bytes conservatively. Cleanup failure does not reverse a successful publication.

Legacy `<cacheRoot>/<modelId>` directories are preserved. File-source caches may be copied into managed storage only after exact pinned size and checksum verification. A marker or nonempty archive extraction cannot prove provenance and remains `unverified`; explicit download or reinstall obtains verified replacement bytes without deleting the legacy directory. A removal tombstone prevents later automatic re-adoption.

<a id="transports-and-native-recognition"></a>
## Transports and native recognition

The [authenticated controller](../../api/voice-controller/README.md) is the Web and Desktop API. Optional loopback POST methods are `engine.status`, `models.list`, `models.download`, `models.reinstall`, `models.update`, `models.cancel`, `models.remove`, and `transcribe`. Both adapters validate requests and dispatch the same operations. The legacy route checks loopback and browser origin metadata; it is not an authentication mechanism.

Native addon loading is lazy. A missing addon leaves model management available and supplies engine repair guidance. Transcription requires verified files and uses the installed generation’s recognizer configuration, even when the catalog fingerprint differs. Native inference is synchronous and cannot be interrupted mid-call; cancellation suppresses the result and teardown waits for settlement.

<a id="model-experience"></a>
## Model Experience

None, as native transcription returns a human-editable Client draft and model-resource management registers no model tools or prompt content.

#### KV Cache effect

Recognition and resource operations do not change model request prefixes; ordinary submission of the draft owns any added context and tokens.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Integrity checks hash model files under the writer lock; size `resourceLockTimeoutMs` for the largest model’s verification time on the target storage.
- A process killed while holding the exclusive writer lock can leave that lock behind. Contenders time out and never steal it; recovery requires confirming that the writer is gone before removing the lock. Interrupted task staging may remain after process loss. Retained legacy data and unknown leases intentionally trade disk space for safety.
- The pinned catalog uses GitHub release archives and commit-pinned `hf-mirror.com` files. Arbitrary user-provided model sources and upstream release discovery are not exposed. No invariant companion is published: storage mutations verify their owned revision and lease relationships directly, and consumers read the authoritative store.

### Dev Note

The [voice decision](../../../.agents/notes/implemented/feature/2026-09-14-voice-dictation-models-and-capture.md) records integrity, cancellation, and concurrent Host tradeoffs.
