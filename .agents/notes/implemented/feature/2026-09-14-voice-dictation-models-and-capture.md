# Agent Note: Pinned voice resources and Host-owned model tasks

Status: implemented

English | [中文](2026-09-14-voice-dictation-models-and-capture.zh.md)

## Problem

A model directory can survive an interrupted transfer, retain a ready marker after corruption, or belong to an older catalog revision. Destructive replacement loses a working recognizer when its replacement fails. Multiple Hosts sharing one cache need a durable publication decision and must not delete files still read by another process. A settings request’s transport lifetime does not express the lifetime of a model installation.

## Decision

The existing Voice runtime, Sherpa provider, and authenticated Remote own the resource lifecycle. Installation requests return branded Host task IDs. A client explicitly cancels the exact task; disconnecting transport leaves admitted work running. The mounted provider retains the latest task per model and joins its own tasks and recognizers during disposal. Task state is Host-local; installation identity is durable.

The version is a SHA-256 fingerprint of the pinned download manifest and recognizer configuration. The catalog makes no upstream release claim and performs no release discovery. File models use commit-pinned `hf-mirror.com` URLs because the operator’s network cannot reach HuggingFace directly; GitHub archive models retain their pinned release URLs. Client provenance strips URL credentials, queries, and fragments. Stable task error codes accompany safe diagnostics so raw network details cannot leak source credentials.

Downloads prepare private staging and validate pinned transport bytes. A persisted file inventory verifies each managed installation. Publication compares a durable revision, renames staging under the commit lock, and atomically replaces the generation pointer. Removal publishes a new tombstone revision even when already absent. A stale task cannot undo another Host’s removal or replacement. Failed replacement preserves the installed pointer. Recognizers lease the installed generation and its recorded architecture until disposal; inactive generations are reclaimed only when no live or unknown process owns a lease.

Legacy directories are user data: they are never deleted by migration. Pinned file caches are copied and verified before adoption; archive markers and nonempty files remain unverified because they do not prove the archive checksum. Explicit installation obtains trusted archive bytes. A removal tombstone prevents automatic legacy re-adoption.

This record retains the model-source decision and supersedes the marker, cancellation, and cache-lifetime realization in the [voice vertical slice](2026-08-30-local-voice-dictation-vertical-slice.md). That note remains active for its local-engine and client ownership rationale. Browser capture and microphone behavior remain owned by the [dictation client](../../../../packages/client/ui-voice-dictation/README.md); neither native resource readiness nor a verified file proves microphone input works.

## Capture ownership

The client captures PCM through `ScriptProcessorNode` at the device sample rate, then linearly resamples to 16 kHz. It disables echo cancellation, noise suppression, and automatic gain control to avoid suppressing dictation input. This capture choice follows observed near-zero samples from the MediaRecorder/decode path; near-zero samples were also observed with ScriptProcessorNode on the operator’s browser, so switching APIs alone does not establish microphone correctness. AudioWorklet migration remains a client concern. The model selector opens upward to avoid moving settings content. These client choices do not alter Host resource ownership.

## Alternatives considered

**Remove before downloading.** Rejected because transient download or integrity failures would destroy a usable installation. Immutable replacement retains the old generation until publication.

**Trust the ready marker or adopt arbitrary nonempty files.** Rejected because neither proves content integrity or catalog provenance. Archive legacy data remains available to the user but is not eligible for recognition until a trusted replacement exists.

**Cancel with the request or model ID alone.** Rejected because a disconnect could abort shared work and a stale action could cancel a newer task. Host-scoped task identity makes cancellation explicit and exact.

**Use process-local locks or time-based stale-lock takeover.** Rejected because separate Hosts share files and a paused live writer can exceed a timeout. Exclusive filesystem locks serialize publication; contenders never steal a writer’s lock. Revision tombstones and prepare-under-lock follow the [security resource store](../../../../packages/security/security-skills/src/resource-store.ts).

## Consequences

Replacement needs temporary disk space for both generations. Unknown readers and retained legacy data can keep extra bytes. A killed writer may leave a lock requiring confirmed manual recovery; a killed task can leave staging. Completed and cancelled tasks remove their transfer parts, so later tasks start fresh. Provider reload resets task receipts but rereads durable resource state without a permanently rejected refresh chain.

The owner-local tests use real Loader composition, Remote carriers, controlled HTTP small models, and real processes for publication and lease lifetimes. Only native recognition is substituted in composition tests. Actual model accuracy, microphone capture, and installed Desktop packaging require their separate owners’ smoke evidence.
