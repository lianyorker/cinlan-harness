# Voice dictation

English | [中文](voice.zh.md)

Voice dictation transcribes a decoded audio clip with a locally installed model. The [voice service](../../packages/voice/voice/README.md) owns model identity and provider registration; the [local provider](../../packages/voice/voice-sherpa-onnx/README.md) owns native resources, downloads, and inference. Consumers own microphone capture and inserting the transcript into the composer.

Source: [`packages/voice/voice/src/types.ts`](../../packages/voice/voice/src/types.ts). The types below belong to the voice group, including types re-exported by transport controllers.

## Model identity and definitions

Definitions describe registered models; cache status describes whether a particular model is installed. Registration alone does not download or load a model.

| Type | Fields and meaning |
|---|---|
| `VoiceModelId` | Branded exact model selector. Duplicate registration rejects; resolving an unknown id raises `VOICE_MODEL_UNKNOWN`. |
| `VoiceModelKind` | `streaming` or `non-streaming` recognizer family. Both use the final-transcript API described below. |
| `VoiceModelDefinition` | `id`, upstream-style display `name`, `description`, `recommended`, `kind`, size hint `approximateBytes`, `download`, and `architecture`. |
| `VoiceModelDownload` | `type: archive` carries a tar.bz2 `url` and `sha256`. `type: files` carries `entries`, each with `name`, `url`, `sha256`, and expected `bytes`. |

`VoiceModelArchitecture` selects the file layout inside the model’s cache directory. Paths identify the files required by that recognizer; language fields configure the corresponding architecture.

| `type` | Required fields |
|---|---|
| `transducer` | `encoder`, `decoder`, `joiner`, `tokens`. |
| `paraformer` | `encoder`, `decoder`, `tokens`. |
| `whisper` | `encoder`, `decoder`, `tokens`, `language`. |
| `sense-voice` | `model`, `tokens`, `language`. |

## Installation and availability

Engine availability is independent of model cache state. A missing provider rejects operations; an installed provider can instead return repair guidance for an unavailable native engine.

| Type | Fields and meaning |
|---|---|
| `VoiceEngineStatus` | `ok: true` reports availability. `ok: false` carries `cause`, repair `command`, nullable launch `profile`, and explanatory `note`. |
| `VoiceModelSummary` | Complete `definition: VoiceModelDefinition` plus `status: VoiceModelStatus`. |
| `VoiceModelRow` | Display-only `definition` with `id`, `name`, `description`, `recommended`, and `approximateBytes`, plus cache `status`; it omits native architecture and download configuration. |
| `VoiceModelsListValue` | Current `models` array of `VoiceModelRow` entries. |
| `VoiceModelsDownloadValue` | Ready `cacheDir` after the shared installation finishes. |

`VoiceModelStatus` is a `state`-discriminated union. Download completion and a ready model directory are separate states.

| `state` | Additional fields and meaning |
|---|---|
| `not-downloaded` | No additional fields. |
| `downloading` | `receivedBytes` and `totalBytes` report transfer progress. |
| `extracting` | `receivedBytes` and `totalBytes`; archive bytes are complete while native extraction and directory validation run. |
| `ready` | `cacheDir` identifies the installed model directory. |
| `failed` | `message` describes the installation failure. |

## Transcription and provider lifetime

The provider receives decoded samples, and the caller supplies cancellation separately. The result settles after the recognizer releases its native resources.

| Type | Fields and meaning |
|---|---|
| `VoiceTranscribeRequest` | `modelId: VoiceModelId` and `samples: Float32Array` containing one 16 kHz mono clip. |
| `VoiceTranscribeResult` | Final transcript in `text`; no partial-result stream. |
| `VoiceEngine` | Stable `id` and `loadModel(definition, cacheDir)`, which returns a ready `VoiceRecognizer` or rejects for an unavailable native binding or missing/corrupt model files. |
| `VoiceRecognizer` | `transcribe(samples)` returns the final transcript for 16 kHz mono float32 PCM; `dispose()` releases native resources and is safe to repeat. |

The same-named [API controller `VoiceTranscribeRequest`](typert.md) is a JSON request with `pcm16kMonoBase64`. The [shared transport parser](../../packages/voice/voice/src/transport.ts) validates canonical little-endian float32 PCM, a 16 MiB decoded bound, and finite samples before producing the voice-owned request above.

`VoiceOperations` supplies the provider-owned callbacks behind `ctx.voice`. Every callback receives an `AbortSignal`; cancellation settles only after its owned work becomes quiescent.

| Operation | Obligation |
|---|---|
| `engineStatus` / `modelsList` | Return engine availability or the current display roster and cache state. |
| `modelsDownload` | Install or await one model’s shared installation; cancelling any waiter cancels that installation. |
| `modelsRemove` | Cancel model work, wait for native resources, then remove the cache and resumable parts. |
| `transcribe` | Transcribe an installed model’s decoded samples and dispose the recognizer before settlement. |

The [runtime](../../packages/voice/voice/src/index.ts) admits one engine and one operations registration. Each registration returns a disposer; withdrawing operations prevents new dispatches immediately. Calls without registered operations reject with `VOICE_UNAVAILABLE`. `VoiceError` carries an open-string error code; it is not a closed error-code union.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxvoice--voiceruntime"></a>

### `ctx.voice` — `VoiceRuntime`

Registry and execution facade for the local voice-dictation engine. Exactly one Provider may register (a swappable-multi-provider seam like mobile-device's is not needed today: there is one embedded local engine, not several competing backends a deployment chooses between at runtime).

```ts cordis-catalog
/**
 * Register one provider's management and transcription operations.
 * @param operations - Provider-owned callbacks, independent of transport.
 * @returns Disposer that immediately prevents new calls to this provider.
 */
registerOperations(operations: VoiceOperations): () => void

/**
 * Read the provider's native engine status.
 * @param signal - Caller cancellation.
 * @returns Availability and repair guidance; rejects when no provider is mounted.
 */
engineStatus(signal: AbortSignal): Promise<VoiceEngineStatus>

/**
 * Read display metadata and current installation state.
 * @param signal - Caller cancellation.
 * @returns The provider's model roster.
 */
modelsList(signal: AbortSignal): Promise<VoiceModelsListValue>

/**
 * Admit a Host-owned download independent of transport lifetime.
 * @param modelId - Registered model identity.
 * @param signal - Admission cancellation; disconnect after admission does not cancel the task.
 * @returns Task receipt; poll modelsList for progress and terminal state.
 */
modelsDownload(modelId: VoiceModelId, signal: AbortSignal): Promise<VoiceModelsDownloadValue>

/**
 * Reinstall the current pinned manifest while retaining the usable installation.
 * @param modelId - Registered model identity.
 * @param signal - Admission cancellation only.
 * @returns Host task receipt.
 */
modelsReinstall(modelId: VoiceModelId, signal: AbortSignal): Promise<VoiceModelTask>

/**
 * Update to the pinned manifest when its fingerprint differs.
 * @param modelId - Registered model identity.
 * @param signal - Admission cancellation only.
 * @returns Host task receipt, including immediate success when already current.
 */
modelsUpdate(modelId: VoiceModelId, signal: AbortSignal): Promise<VoiceModelTask>

/**
 * Cancel exactly one running Host task and await its cleanup.
 * @param modelId - Registered model identity.
 * @param taskId - Identity returned by task admission or modelsList.
 * @param signal - Cancellation before admission; accepted cancellation joins the task.
 * @returns Whether this call cancelled the matching running task.
 */
modelsCancel(modelId: VoiceModelId, taskId: VoiceModelTaskId, signal: AbortSignal): Promise<VoiceModelsCancelValue>

/**
 * Cancel model work and remove its cache after resources settle.
 * @param modelId - Registered model identity.
 * @param signal - Caller cancellation before deletion begins.
 */
modelsRemove(modelId: VoiceModelId, signal: AbortSignal): Promise<void>

/**
 * Transcribe decoded audio with the installed model.
 * @param request - Model identity and 16kHz mono float32 samples.
 * @param signal - Caller cancellation; native calls settle before resources release.
 * @returns Transcript after recognizer disposal.
 */
transcribe(request: VoiceTranscribeRequest, signal: AbortSignal): Promise<VoiceTranscribeResult>

/**
 * Register the local engine implementation for the calling plugin lifetime.
 * A second registration throws: exactly one engine may be mounted.
 * @param engine - the local speech-to-text engine implementation.
 * @returns disposer removing the engine registration.
 */
registerEngine(engine: VoiceEngine): () => void

/**
 * Register one shipped model definition for the calling plugin lifetime.
 * Duplicate ids throw: model identity is a composition-level contract.
 * @param definition - the model's display metadata and download source.
 * @returns disposer removing the model registration.
 */
registerModel(definition: VoiceModelDefinition): () => void

/**
 * List every registered model definition in registration order.
 * @returns the shipped model roster.
 */
listDefinitions(): readonly VoiceModelDefinition[]

/**
 * Resolve one registered model definition.
 * @param modelId - exact model id.
 * @returns the definition.
 * @throws {VoiceError} VOICE_MODEL_UNKNOWN when no such model is registered.
 */
requireDefinition(modelId: VoiceModelId): VoiceModelDefinition
```

Source: [`packages/voice/voice/src/index.ts`](../../packages/voice/voice/src/index.ts)
<!-- END GENERATED cordis-surface -->
