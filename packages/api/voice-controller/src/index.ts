/** Authenticated voice Remote; Web Connection and Desktop carriers own caller authorization. */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { VoiceError } from '@deepseek-ai/dsh-voice'
import { parseVoiceModelRequest, parseVoiceTranscribeRequest } from '@deepseek-ai/dsh-voice/transport'
import type {
  VoiceEngineStatus, VoiceModelRequest, VoiceModelsDownloadValue, VoiceModelsListValue,
  VoiceModelsRemoveValue, VoiceTranscribeRequest, VoiceTranscribeResult,
} from './types.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Authenticated local voice management and transcription. */
    voiceController: VoiceController
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Malformed model selector or PCM payload. */
    'voice/invalid-request': { readonly code: string }
    /** Model selector absent from the provider roster. */
    'voice/model-unknown': { readonly code: string }
    /** Model files must be downloaded before transcription. */
    'voice/model-not-ready': { readonly code: string }
    /** Provider, native module, or required resource is unavailable. */
    'voice/unavailable': { readonly code: string }
    /** Another operation is removing the selected model. */
    'voice/model-busy': { readonly code: string }
    /** The operation failed after admission. */
    'voice/operation-failed': { readonly code: string }
  }
}

/** Transport adapter over the provider-neutral voice operations. */
export class VoiceController extends TypertRemoteService {
  static inject = ['typert', 'voice']

  constructor(ctx: Context) {
    super(ctx, 'voiceController', { namespace: 'voice' })
  }

  /**
   * Read native engine availability without downloading models.
   * @param signal - Transport cancellation.
   * @returns Availability and provider repair guidance.
   */
  @Remote
  engineStatus(signal: AbortSignal): Promise<VoiceEngineStatus> {
    return this.invoke(signal, () => this.ctx.voice.engineStatus(signal))
  }

  /**
   * Read the model roster and current cache state.
   * @param signal - Transport cancellation.
   * @returns Display metadata and installation status.
   */
  @Remote
  modelsList(signal: AbortSignal): Promise<VoiceModelsListValue> {
    return this.invoke(signal, () => this.ctx.voice.modelsList(signal))
  }

  /**
   * Download or await a model installation.
   * @param request - Exact model selector from modelsList.
   * @param signal - Cancels the shared model installation and awaits its cleanup.
   * @returns Ready cache directory.
   */
  @Remote
  modelsDownload(request: VoiceModelRequest, signal: AbortSignal): Promise<VoiceModelsDownloadValue> {
    return this.invoke(signal, () => this.ctx.voice.modelsDownload(parseVoiceModelRequest(request), signal))
  }

  /**
   * Cancel model work and remove the downloaded files.
   * @param request - Exact model selector from modelsList.
   * @param signal - Caller cancellation before deletion starts.
   * @returns Empty receipt after removal and resource cleanup.
   */
  @Remote
  modelsRemove(request: VoiceModelRequest, signal: AbortSignal): Promise<VoiceModelsRemoveValue> {
    return this.invoke(signal, async () => {
      await this.ctx.voice.modelsRemove(parseVoiceModelRequest(request), signal)
      return {}
    })
  }

  /**
   * Transcribe bounded canonical base64 PCM with an installed model.
   * @param request - Model selector and little-endian 16kHz mono float32 PCM.
   * @param signal - Transport cancellation; native work settles before resources release.
   * @returns Transcript after recognizer disposal.
   */
  @Remote
  transcribe(request: VoiceTranscribeRequest, signal: AbortSignal): Promise<VoiceTranscribeResult> {
    return this.invoke(signal, () => this.ctx.voice.transcribe(parseVoiceTranscribeRequest(request), signal))
  }

  private async invoke<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    signal.throwIfAborted()
    try {
      const value = await operation()
      signal.throwIfAborted()
      return value
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof VoiceError) {
        const details = { code: error.code }
        switch (error.code) {
          case 'VOICE_INVALID_REQUEST': throw new RemoteError('voice/invalid-request', error.message, details)
          case 'VOICE_MODEL_UNKNOWN': throw new RemoteError('voice/model-unknown', error.message, details)
          case 'VOICE_MODEL_NOT_READY': throw new RemoteError('voice/model-not-ready', error.message, details)
          case 'VOICE_UNAVAILABLE':
          case 'VOICE_ENGINE_DEGRADED': throw new RemoteError('voice/unavailable', error.message, details)
          case 'VOICE_MODEL_BUSY': throw new RemoteError('voice/model-busy', error.message, details)
          // VoiceError codes are open to providers; unclassified failures use one stable Remote code.
          default: throw new RemoteError('voice/operation-failed', error.message, details)
        }
      }
      throw new RemoteError('voice/operation-failed', 'Voice operation failed; check the local engine and model files', { code: 'VOICE_OPERATION_FAILED' })
    }
  }
}

export default VoiceController
