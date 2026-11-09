/** Serializable requests and results for authenticated voice Remote consumers. */
export type {
  VoiceEngineStatus,
  VoiceModelTask,
  VoiceModelTaskId,
  VoiceModelResource,
  VoiceModelsCancelValue,
  VoiceModelStatus,
  VoiceModelRow,
  VoiceModelsListValue,
  VoiceModelsDownloadValue,
  VoiceTranscribeResult,
  VoiceAudioChunk,
  VoiceTranscriptFrame,
} from '@cinlan/voice/types'
import type { VoiceModelRow } from '@cinlan/voice/types'

/** Exact model selector from the model list. */
export interface VoiceModelRequest {
  readonly modelId: string
}

/** Exact Host task identity; cancellation never targets a replacement task. */
export interface VoiceCancelRequest extends VoiceModelRequest {
  readonly taskId: string
}

/** Canonical base64 of little-endian 16kHz mono float32 PCM, bounded to 16 MiB decoded. */
export interface VoiceTranscribeRequest extends VoiceModelRequest {
  readonly pcm16kMonoBase64: string
  readonly language?: string
}

/** API-key presence state for the OpenAI cloud transcription provider. */
export interface VoiceOpenAiKeyStatus {
  readonly configured: boolean
  readonly writable: boolean
}

/** Host directory selected for user model import. */
export interface VoiceModelsImportRequest {
  readonly sourcePath: string
}
/** Imported model row published from a validated user-owned directory. */
export type VoiceModelsImportValue = VoiceModelRow

/** Successful removal has no additional fields. */
export type VoiceModelsRemoveValue = Record<string, never>
