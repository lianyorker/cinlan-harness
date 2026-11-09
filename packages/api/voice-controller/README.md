---
description: "Manage local speech models and transcribe audio through the authenticated Web and desktop Remote."
kind: "package-reference"
---
# Voice Controller

English | [中文](README.zh.md)

## Summary

`@cinlan/api-voice-controller` exposes local engine status, model resources, and transcription to Web and Desktop clients. Both carriers call the same provider operations; Desktop does not need an HTTP server. Transcription returns text for an editable draft and does not submit a message.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this controller with `typert` and [`voice`](../../voice/voice/README.md). The [Sherpa provider](../../voice/voice-sherpa-onnx/README.md) supplies native recognition and model management; the optional OpenAI provider supplies cloud transcription. The application supplies the authenticated [Connection](../../client/connection/README.md) and [Gateway](../gateway/README.md) carrier. This controller has no configuration fields.

```yaml
- name: '@cinlan/api-voice-controller'
```

Generated `ctx.remote.voice` methods return a `RemoteResult` envelope. Pass the optional `AbortSignal` as the final argument; display success only when `ok` is true.

| Method | Input | Successful value |
|---|---|---|
| `engineStatus(signal?)` | None | Native availability or degraded repair guidance |
| `modelsList(signal?)` | None | `{ models }` with current cache status |
| `modelsDownload(request, signal?)` | `{ modelId }` | Host task admission receipt |
| `modelsReinstall(request, signal?)` | `{ modelId }` | Forced replacement task receipt |
| `modelsUpdate(request, signal?)` | `{ modelId }` | Pinned-manifest update task receipt |
| `modelsCancel(request, signal?)` | `{ modelId, taskId }` | `{ cancelled }` after exact-task cleanup |
| `modelsRemove(request, signal?)` | `{ modelId }` | `{}` after model work and removal settle |
| `modelsImport(request, signal?)` | `{ sourcePath }` | Verified imported model row |
| `transcribe(request, signal?)` | `{ modelId, pcm16kMonoBase64 }` | `{ text }` |
| `transcribeStream(request, signal?)` | `{ modelId }` plus bounded PCM uplink | Partial and final transcript frames for a streaming model |
| `openAiKeyStatus(signal?)` / `openAiKeySave(value, signal?)` / `openAiKeyClear(signal?)` | Key status or `{ apiKey }` | Credential status or `{}` |

Complete-clip PCM is canonical base64 of little-endian, finite float32 samples at 16 kHz mono, limited to 16 MiB decoded. Stream uplink items use the same encoding and are limited to 64 KiB decoded each. The controller validates stream items through the voice provider operation; the optional legacy HTTP adapter supports only complete-clip transcription. Model identifiers must come from the available roster. A model must be ready before transcription, and only streaming models accept `transcribeStream`.

Malformed requests, unknown models, missing files, concurrent model removal, unavailable providers, and operation failures use `voice/invalid-request`, `voice/model-unknown`, `voice/model-not-ready`, `voice/model-busy`, `voice/unavailable`, and `voice/operation-failed`. List and transcription cancellation follows the carrier. Installation methods return task receipts; disconnection after admission does not cancel Host work. Poll `modelsList` for `task` progress and terminal state, and `resource` source, fingerprints, and integrity. Explicit cancellation requires this Host’s exact task ID; stale or terminal IDs return false without deleting models. Provider-specific `VoiceError` codes remain in error details; unexpected exceptions use a fixed public message.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host service is `voiceController`; its Remote namespace is `voice`. The controller owns request decoding and error translation. The provider owns downloads, cache state, and recognizer cleanup. Removing the provider withdraws operations before awaiting cancellation; removing the controller withdraws its endpoints.

[Composition tests](tests/composition.spec.ts) boot real Loader rows and exercise the Desktop Fetch carrier without `webServer`, authenticated HTTP, optional legacy HTTP parity, cancellation, and provider/controller reload. Only external native recognition and download inputs are controlled. No invariant companion is published because this adapter owns no independent resource state beyond its provider and carrier.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Voice definition](../../voice/voice/README.md) — provider-neutral operations and types.
- [Sherpa provider](../../voice/voice-sherpa-onnx/README.md) — model downloads and native recognition.
- [Dictation UI](../../client/ui-voice-dictation/README.md) — capture, preferences, and draft insertion.

-----

<a id="model-experience"></a>
## Model Experience

None, as voice operations return client data without sending a message or adding model context.

#### KV Cache effect

No effect until the user submits the resulting draft through the ordinary conversation flow.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- Complete-clip offline native inference is cooperative: cancellation suppresses the result, and teardown waits for the recognizer call to settle before releasing it. Streaming inference has a separate process lifetime owned by the provider.
- Microphone permission and capture remain client responsibilities. Engine availability depends on the local native module and downloaded model files.
