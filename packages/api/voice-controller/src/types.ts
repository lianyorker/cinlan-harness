/** Serializable requests and results for authenticated voice Remote consumers. */
export type {
  VoiceEngineStatus,
  VoiceModelStatus,
  VoiceModelRow,
  VoiceModelsListValue,
  VoiceModelsDownloadValue,
  VoiceTranscribeResult,
} from '@deepseek-ai/dsh-voice/types'

/** Exact model selector from the model list. */
export interface VoiceModelRequest {
  readonly modelId: string
}

/** Canonical base64 of little-endian 16kHz mono float32 PCM, bounded to 16 MiB decoded. */
export interface VoiceTranscribeRequest extends VoiceModelRequest {
  readonly pcm16kMonoBase64: string
}

/** Successful removal has no additional fields. */
export type VoiceModelsRemoveValue = Record<string, never>
