/** Voice operations over the generated Remote shared by Web and desktop carriers. */
import type { ClientRemote, RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  VoiceEngineStatus, VoiceModelsDownloadValue, VoiceModelsListValue, VoiceModelsRemoveValue, VoiceTranscribeResult,
} from '@deepseek-ai/dsh-api-voice-controller/types'

export type { VoiceEngineStatus, VoiceModelRow } from '@deepseek-ai/dsh-api-voice-controller/types'

/** One typed Host refusal reported to the voice controls. */
export class VoiceApiError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

async function unwrap<T>(operation: Promise<RemoteResult<T>>): Promise<T> {
  const result = await operation
  if (!result.ok) throw new VoiceApiError(result.error.code, result.error.message)
  return result.value
}

/**
 * Bind voice callbacks to the current carrier's generated namespace.
 * @param remote - the voice Remote mounted by the application composition.
 * @returns plain callbacks; transport rejection and cancellation retain their original errors.
 */
export function createVoiceApi(remote: ClientRemote['voice']) {
  return {
    engineStatus: (signal?: AbortSignal) => unwrap<VoiceEngineStatus>(remote.engineStatus(signal)),
    modelsList: (signal?: AbortSignal) => unwrap<VoiceModelsListValue>(remote.modelsList(signal)),
    modelsDownload: (modelId: string, signal?: AbortSignal) =>
      unwrap<VoiceModelsDownloadValue>(remote.modelsDownload({ modelId }, signal)),
    modelsRemove: (modelId: string, signal?: AbortSignal) =>
      unwrap<VoiceModelsRemoveValue>(remote.modelsRemove({ modelId }, signal)),
    transcribe: (modelId: string, pcm16kMonoBase64: string, signal?: AbortSignal) =>
      unwrap<VoiceTranscribeResult>(remote.transcribe({ modelId, pcm16kMonoBase64 }, signal)),
  }
}

/** Plain operation callbacks injected into the settings and composer entries. */
export type VoiceApi = ReturnType<typeof createVoiceApi>
