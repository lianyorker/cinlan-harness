# Agent Note: Pinned voice resources and Host-owned model tasks

Status: implemented

English | [中文](2026-09-14-voice-dictation-models-and-capture.zh.md)

## Problem

A model directory can survive an interrupted transfer, retain a ready marker after corruption, or belong to an older catalog revision. Destructive replacement loses a working recognizer when its replacement fails. Multiple Hosts sharing one cache need a durable publication decision and must not delete files still read by another process. A settings request’s transport lifetime does not express the lifetime of a model installation.

## Decision

The Voice runtime routes models to local and cloud providers. The Sherpa provider owns verified generations and Host task IDs; the optional OpenAI provider reads `OPENAI_API_KEY` from Host credentials and sends bounded WAV requests to the transcription endpoint. Authenticated Remotes store, rotate, and clear the key without returning it. User model imports require a `clh-voice-model.json` manifest, copy regular files into verified generations, survive provider reload, and remove only managed bytes. Browser preferences retain language selection and pass supported hints to OpenAI, Whisper, and SenseVoice.

Installation requests return branded Host task IDs. A client explicitly cancels the exact task; disconnecting transport leaves admitted work running. The mounted provider retains the latest task per model and joins its own tasks and recognizers during disposal. Task state is Host-local; installation identity is durable.

The version is a SHA-256 fingerprint of the pinned download manifest and recognizer configuration. The catalog makes no upstream release claim and performs no release discovery. File models use commit-pinned `hf-mirror.com` URLs because the operator’s network cannot reach HuggingFace directly; GitHub archive models retain their pinned release URLs. Client provenance strips URL credentials, queries, and fragments. Stable task error codes accompany safe diagnostics so raw network details cannot leak source credentials.

Downloads prepare private staging and validate pinned transport bytes. A persisted file inventory verifies each managed installation. Publication compares a durable revision, renames staging under the commit lock, and atomically replaces the generation pointer. Removal publishes a new tombstone revision even when already absent. A stale task cannot undo another Host’s removal or replacement. Failed replacement preserves the installed pointer. Recognizers lease the installed generation and its recorded architecture until disposal; inactive generations are reclaimed only when no live or unknown process owns a lease.

Legacy directories are user data: they are never deleted by migration. Pinned file caches are copied and verified before adoption; archive markers and nonempty files remain unverified because they do not prove the archive checksum. Explicit installation obtains trusted archive bytes. A removal tombstone prevents automatic legacy re-adoption.

This record retains the model-source decision and supersedes the marker, cancellation, and cache-lifetime realization in the [voice vertical slice](2026-08-30-local-voice-dictation-vertical-slice.md). That note remains active for its local-engine and client ownership rationale. Browser capture and microphone behavior remain owned by the [dictation client](../../../../packages/client/ui-voice-dictation/README.md); neither native resource readiness nor a verified file proves microphone input works.

## Capture ownership

The client captures PCM through an inline `AudioWorkletNode` processor at the device sample rate, then linearly resamples to 16 kHz. It disables echo cancellation, noise suppression, and automatic gain control to avoid suppressing dictation input. The processor is loaded from a temporary Blob URL and transfers copied `Float32Array` frames through its `MessagePort`; capture cancellation revokes the URL and closes the context, port, nodes, and microphone tracks. If a microphone track ends during dictation, the client closes capture, discards incomplete audio, and notifies the initiating session without switching devices. Chromium browser coverage verifies module loading and nonzero frames from its fake microphone. This does not establish physical-device amplitude or model accuracy; near-zero samples remain a physical-device risk. The model selector opens upward to avoid moving settings content. These client choices do not alter Host resource ownership.

## Alternatives considered

**Remove before downloading.** Rejected because transient download or integrity failures would destroy a usable installation. Immutable replacement retains the old generation until publication.

**Trust the ready marker or adopt arbitrary nonempty files.** Rejected because neither proves content integrity or catalog provenance. Archive legacy data remains available to the user but is not eligible for recognition until a trusted replacement exists.

**Cancel with the request or model ID alone.** Rejected because a disconnect could abort shared work and a stale action could cancel a newer task. Host-scoped task identity makes cancellation explicit and exact.

**Use process-local locks or time-based stale-lock takeover.** Rejected because separate Hosts share files and a paused live writer can exceed a timeout. Exclusive filesystem locks serialize publication; contenders never steal a writer’s lock. Revision tombstones and prepare-under-lock follow the [security resource store](../../../../packages/security/security-skills/src/resource-store.ts).

## Consequences

Replacement needs temporary disk space for both generations. Unknown readers and retained legacy data can keep extra bytes. A killed writer may leave a lock requiring confirmed manual recovery; a killed task can leave staging. Completed and cancelled tasks remove their transfer parts, so later tasks start fresh. Provider reload resets task receipts but rereads durable resource state without a permanently rejected refresh chain.

The owner-local tests use real Loader composition, authenticated HTTP and WebSocket Gateway carriers, controlled OpenAI and model HTTP servers, and real processes for publication and lease lifetimes. Native acceptance uses an installed sherpa cache generation and the repository model's WAV sample; the test verifies nonempty output, unary/stream parity, and lease cleanup. Physical microphone input remains a separate acceptance item; the OpenAI provider test uses a controlled HTTP server and does not require a production API key.
