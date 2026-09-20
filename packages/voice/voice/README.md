---
description: "Provider-neutral local speech model tasks and transcription."
kind: "package-reference"
---
# Voice runtime

English | [中文](README.zh.md)

## Summary

The `ctx.voice` service registers one local speech engine, a model catalog, and provider-owned model management and transcription operations. Clients own microphone permission, audio capture, and draft insertion.

## Table of Contents

- [Use this package](#use-this-package)
- [Task semantics](#task-semantics)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount `@deepseek-ai/dsh-voice` with the [Sherpa provider](../voice-sherpa-onnx/README.md) and the [authenticated controller](../../api/voice-controller/README.md). This service has no configuration. Every engine, model, and operations registration returns a disposer; duplicate registrations fail explicitly. Missing provider operations reject with `VOICE_UNAVAILABLE`.

The pure `/types` entry supplies browser declarations. The Node `/transport` entry validates model and exact-task requests plus canonical base64 little-endian float32 PCM, limited to 16 MiB decoded with finite samples.

<a id="task-semantics"></a>
## Task semantics

Download, reinstall, and update return a branded Host task identity at admission. Transport cancellation applies before admission; later disconnection does not cancel the task. `modelsList` returns each model’s durable resource identity and this Host’s latest task. `modelsCancel` cancels and joins only a matching running task. A stale identity, another Host’s identity, or a terminal task returns `cancelled: false`. Provider disposal cancels and joins its own tasks.

Resource versions are SHA-256 fingerprints of pinned manifests, with sanitized source URLs and explicit integrity state. Reinstall forces replacement; update compares the installed fingerprint with the pinned catalog. A verified old generation stays ready while replacement runs or fails. The provider owns durable revision checks and recognizer leases; [storage semantics](../voice-sherpa-onnx/README.md#resource-lifecycle) define legacy verification and deletion.

<a id="model-experience"></a>
## Model Experience

### Consumer-owned results

#### What the model sees

None. Transcription returns text for a client draft; only ordinary submission makes it model-visible.

#### Token effect

None until the client submits the draft.

#### KV Cache effect

Registration, model tasks, and resource status never enter model requests.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

The service exposes one final transcript per clip, without incremental hypotheses. Model and microphone preferences belong to the client. No invariant companion is published: consumers read the same registries that enforce registration ownership.

## Dev Note

The [voice decision](../../../.agents/notes/implemented/feature/2026-09-14-voice-dictation-models-and-capture.md) records model integrity and Host task ownership.
