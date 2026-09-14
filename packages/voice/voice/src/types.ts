/** Type-only declarations for the local voice-dictation model registry and transcription request/response shapes. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identifier for one shipped voice-dictation model definition. */
export type VoiceModelId = Branded<'VoiceModelId'>

/** Streaming (chunk-by-chunk) or non-streaming (whole-utterance) recognizer family. */
export type VoiceModelKind = 'streaming' | 'non-streaming'

/** One shipped model definition: display metadata plus its download source. */
export interface VoiceModelDefinition {
  readonly id: VoiceModelId
  /** Localization-free display name (matches the upstream sherpa-onnx release naming). */
  readonly name: string
  readonly kind: VoiceModelKind
  /** Approximate encoded download size in bytes, for the settings page's size hint. */
  readonly approximateBytes: number
  /** The exact upstream release archive to download and cache locally. */
  readonly archiveUrl: string
  /** Lowercase SHA-256 of the encoded archive; installation rejects any other bytes. */
  readonly archiveSha256: string
  /** The relative path, inside the extracted archive, sherpa-onnx-node's OnlineRecognizer config expects for each required file. */
  readonly files: {
    readonly encoder: string
    readonly decoder: string
    readonly joiner: string
    readonly tokens: string
  }
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

/** One base64-encoded audio clip submitted for transcription. */
export interface VoiceTranscribeRequest {
  readonly modelId: VoiceModelId
  /** 16kHz mono PCM float32 samples, canonical base64 encoding. */
  readonly pcm16kMonoBase64: string
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
