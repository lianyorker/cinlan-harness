/** Type-only declarations for the local voice-dictation model registry and transcription request/response shapes. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identifier for one shipped voice-dictation model definition. */
export type VoiceModelId = Branded<'VoiceModelId'>

/** Streaming (chunk-by-chunk) or non-streaming (whole-utterance) recognizer family. */
export type VoiceModelKind = 'streaming' | 'non-streaming'

/** Recognizer architecture and the model file paths each one expects in its cache directory. */
export type VoiceModelArchitecture =
  | { readonly type: 'transducer'; readonly encoder: string; readonly decoder: string; readonly joiner: string; readonly tokens: string }
  | { readonly type: 'paraformer'; readonly encoder: string; readonly decoder: string; readonly tokens: string }
  | { readonly type: 'whisper'; readonly encoder: string; readonly decoder: string; readonly tokens: string; readonly language: string }
  | { readonly type: 'sense-voice'; readonly model: string; readonly tokens: string; readonly language: string }

/** Download source: either a single tar.bz2 archive or individual files from a hosting provider. */
export type VoiceModelDownload =
  | { readonly type: 'archive'; readonly url: string; readonly sha256: string }
  | { readonly type: 'files'; readonly entries: readonly { readonly name: string; readonly url: string; readonly sha256: string; readonly bytes: number }[] }

/** One shipped model definition: display metadata plus its download source and recognizer architecture. */
export interface VoiceModelDefinition {
  readonly id: VoiceModelId
  /** Localization-free display name (matches the upstream sherpa-onnx release naming). */
  readonly name: string
  /** Short user-facing description of the model's language coverage and strengths. */
  readonly description: string
  /** Whether this model is recommended for most users. */
  readonly recommended: boolean
  readonly kind: VoiceModelKind
  /** Approximate total download size in bytes, for the settings page's size hint. */
  readonly approximateBytes: number
  readonly download: VoiceModelDownload
  readonly architecture: VoiceModelArchitecture
}

/** Per-model download/cache lifecycle state reported to the settings page. */
export type VoiceModelStatus =
  | { readonly state: 'not-downloaded' }
  | { readonly state: 'downloading'; readonly receivedBytes: number; readonly totalBytes: number }
  /** Archive bytes are complete; native tar is extracting and validating the model directory. */
  | { readonly state: 'extracting'; readonly receivedBytes: number; readonly totalBytes: number }
  | { readonly state: 'ready'; readonly cacheDir: string }
  | { readonly state: 'failed'; readonly message: string }

/** One model row as reported by the settings page's list call. */
export interface VoiceModelSummary {
  readonly definition: VoiceModelDefinition
  readonly status: VoiceModelStatus
}

/** One decoded 16kHz mono audio clip submitted to the local provider. */
export interface VoiceTranscribeRequest {
  readonly modelId: VoiceModelId
  readonly samples: Float32Array
}

/** Native engine availability and provider-owned repair guidance. */
export type VoiceEngineStatus =
  | { readonly ok: true }
  | { readonly ok: false; readonly cause: string; readonly command: string; readonly profile: string | null; readonly note: string }

/** Display metadata and live cache status, without native model configuration. */
export interface VoiceModelRow {
  readonly definition: Pick<VoiceModelDefinition, 'id' | 'name' | 'description' | 'recommended' | 'approximateBytes'>
  readonly status: VoiceModelStatus
}

/** Current model roster and cache state. */
export interface VoiceModelsListValue {
  readonly models: readonly VoiceModelRow[]
}

/** Ready cache directory after a completed download. */
export interface VoiceModelsDownloadValue {
  readonly cacheDir: string
}

/** Provider-owned operations; cancellation settles only after owned work is quiescent. */
export interface VoiceOperations {
  /** Read native engine availability. */
  engineStatus(signal: AbortSignal): Promise<VoiceEngineStatus>
  /** List models with their current installation state. */
  modelsList(signal: AbortSignal): Promise<VoiceModelsListValue>
  /** Install one model; cancelling any waiter cancels its shared installation. */
  modelsDownload(modelId: VoiceModelId, signal: AbortSignal): Promise<VoiceModelsDownloadValue>
  /** Cancel model work, await native resources, and remove the cache and resumable parts. */
  modelsRemove(modelId: VoiceModelId, signal: AbortSignal): Promise<void>
  /** Transcribe decoded samples and release the recognizer before settlement. */
  transcribe(request: VoiceTranscribeRequest, signal: AbortSignal): Promise<VoiceTranscribeResult>
}

/** Transcription result. */
export interface VoiceTranscribeResult {
  readonly text: string
}

/** Swappable local speech-to-text engine contract a Provider implements. */
export interface VoiceEngine {
  /** Stable engine id (e.g. 'sherpa-onnx'), reported in degraded-mode diagnostics. */
  readonly id: string
  /**
   * Load one downloaded model's files and produce a ready recognizer handle;
   * throws when the engine's native binding failed to load (degraded mode) or
   * the model files are absent/corrupt.
   */
  loadModel(definition: VoiceModelDefinition, cacheDir: string): Promise<VoiceRecognizer>
}

/** One loaded recognizer instance bound to one model. */
export interface VoiceRecognizer {
  /** Run inference on 16kHz mono PCM float32 samples and return the final transcript. */
  transcribe(samples: Float32Array): Promise<string>
  /** Release native resources; safe to call more than once. */
  dispose(): void
}
