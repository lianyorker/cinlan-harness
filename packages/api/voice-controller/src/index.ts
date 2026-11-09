/** Authenticated voice Remote; Web Connection and Desktop carriers own caller authorization. */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteStream } from '@deepseek-ai/dsh-typert-protocol'
import { VoiceError } from '@cinlan/voice'
import { parseVoiceCancelRequest, parseVoiceModelRequest, parseVoiceTranscribeRequest } from '@cinlan/voice/transport'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { z } from 'zod'
import type {
  VoiceEngineStatus, VoiceModelRequest, VoiceModelsDownloadValue, VoiceModelsListValue,
  VoiceModelsRemoveValue, VoiceTranscribeRequest, VoiceTranscribeResult,
  VoiceModelTask, VoiceCancelRequest, VoiceModelsCancelValue,
  VoiceAudioChunk, VoiceTranscriptFrame,
  VoiceOpenAiKeyStatus,
  VoiceModelsImportRequest, VoiceModelsImportValue,
} from './types.ts'
export type * from './types.ts'
const importRequest = z.strictObject({ sourcePath: z.string().min(1).max(4096).refine(path => !path.includes('\0')) })
const keyRequest = z.strictObject({ apiKey: z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/) })

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
    /** Selected model cannot accept incremental audio. */
    'voice/stream-unsupported': { readonly code: string }
  }
}

/** Transport adapter over the provider-neutral voice operations. */
export class VoiceController extends TypertRemoteService {
  static inject = ['typert', 'voice', 'credentials']

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
   * Admit a Host-owned model installation.
   * @param request - Exact model selector from modelsList.
   * @param signal - Admission cancellation only; disconnect does not cancel admitted work.
   * @returns Task receipt; modelsList reports progress and settlement.
   */
  @Remote
  modelsDownload(request: VoiceModelRequest, signal: AbortSignal): Promise<VoiceModelsDownloadValue> {
    return this.invoke(signal, () => this.ctx.voice.modelsDownload(parseVoiceModelRequest(request), signal))
  }

  /**
   * Replace a model using its pinned manifest, preserving the old installation on failure.
   * @param request - Exact model selector.
   * @param signal - Admission cancellation only.
   * @returns Host-owned task receipt.
   */
  @Remote
  modelsReinstall(request: VoiceModelRequest, signal: AbortSignal): Promise<VoiceModelTask> {
    return this.invoke(signal, () => this.ctx.voice.modelsReinstall(parseVoiceModelRequest(request), signal))
  }

  /**
   * Install a changed pinned manifest; no upstream release discovery occurs.
   * @param request - Exact model selector.
   * @param signal - Admission cancellation only.
   * @returns Host-owned task receipt.
   */
  @Remote
  modelsUpdate(request: VoiceModelRequest, signal: AbortSignal): Promise<VoiceModelTask> {
    return this.invoke(signal, () => this.ctx.voice.modelsUpdate(parseVoiceModelRequest(request), signal))
  }

  /**
   * Cancel one matching task without removing installed model files.
   * @param request - Model and task identity returned by this Host.
   * @param signal - Cancellation before admission.
   * @returns Whether the matching running task was cancelled and joined.
   */
  @Remote
  modelsCancel(request: VoiceCancelRequest, signal: AbortSignal): Promise<VoiceModelsCancelValue> {
    return this.invoke(signal, () => {
      const { modelId, taskId } = parseVoiceCancelRequest(request)
      return this.ctx.voice.modelsCancel(modelId, taskId, signal)
    })
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

  /** Import a user model from a Host directory containing a voice manifest.
   * @param request - Absolute source directory selected by the client.
   * @param signal - Cancels import before publication.
   * @returns Verified managed model row, without changing the source directory.
   */
  @Remote
  modelsImport(request: VoiceModelsImportRequest, signal: AbortSignal): Promise<VoiceModelsImportValue> {
    return this.invoke(signal, () => {
      const parsed = importRequest.safeParse(request)
      if (!parsed.success) {
        throw new VoiceError('invalid model directory', 'VOICE_INVALID_REQUEST')
      }
      return this.ctx.voice.modelsImport(parsed.data.sourcePath, signal)
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

  /** Read whether the managed OpenAI API key is configured without exposing it.
   * @param signal - Transport cancellation.
   * @returns Host credential presence and write capability, without the key.
   */
  @Remote
  async openAiKeyStatus(signal: AbortSignal): Promise<VoiceOpenAiKeyStatus> {
    return this.invoke(signal, async () => {
      const info = await this.ctx.credentials.describe(credentialRef('OPENAI_API_KEY'))
      return { configured: info.configured, writable: info.writable }
    })
  }

  /** Store a new OpenAI API key in the credentials provider.
   * @param value - Nonempty API key without whitespace or control characters.
   * @param signal - Transport cancellation; an admitted credential write may commit.
   * @returns Empty receipt after the Host credential write settles.
   */
  @Remote
  openAiKeySave(value: { readonly apiKey: string }, signal: AbortSignal): Promise<Record<string, never>> {
    return this.invoke(signal, async () => {
      const parsed = keyRequest.safeParse(value)
      if (!parsed.success) throw new VoiceError('Invalid OpenAI API key', 'VOICE_INVALID_REQUEST')
      await this.ctx.credentials.set(credentialRef('OPENAI_API_KEY'), parsed.data.apiKey)
      return {}
    })
  }

  /** Remove the managed OpenAI API key.
   * @param signal - Transport cancellation; an admitted credential write may commit.
   * @returns Empty receipt after the Host credential removal settles.
   */
  @Remote
  openAiKeyClear(signal: AbortSignal): Promise<Record<string, never>> {
    return this.invoke(signal, async () => {
      await this.ctx.credentials.unset(credentialRef('OPENAI_API_KEY'))
      return {}
    })
  }

  /**
   * Incrementally transcribe bounded PCM uplink items with an online model.
   * @param request - Exact model selector from modelsList.
   * @param signal - Stream cancellation; provider cleanup completes before iteration settles.
   * @returns Partial hypotheses followed by one final transcript.
   */
  @Remote({ mode: 'stream' })
  transcribeStream(request: VoiceModelRequest, signal: AbortSignal): RemoteStream<VoiceTranscriptFrame, VoiceAudioChunk> {
    const invocation = this.ctx.invocation
    if (invocation === undefined) throw new Error('Voice streaming requires a Remote invocation')
    return this.streamTranscription(parseVoiceModelRequest(request), invocation.uplink<VoiceAudioChunk>(), signal)
  }

  private async *streamTranscription(
    modelId: ReturnType<typeof parseVoiceModelRequest>,
    chunks: AsyncIterable<VoiceAudioChunk>,
    signal: AbortSignal,
  ): AsyncIterable<VoiceTranscriptFrame> {
    signal.throwIfAborted()
    try {
      yield* this.ctx.voice.transcribeStream(modelId, chunks, signal)
      signal.throwIfAborted()
    } catch (error) {
      signal.throwIfAborted()
      this.mapFailure(error)
    }
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
        this.mapFailure(error)
      }
      throw new RemoteError('voice/operation-failed', 'Voice operation failed; check the local engine and model files', { code: 'VOICE_OPERATION_FAILED' })
    }
  }

  private mapFailure(error: unknown): never {
    if (error instanceof VoiceError) {
      const details = { code: error.code }
      switch (error.code) {
        case 'VOICE_INVALID_REQUEST': throw new RemoteError('voice/invalid-request', error.message, details)
        case 'VOICE_MODEL_UNKNOWN': throw new RemoteError('voice/model-unknown', error.message, details)
        case 'VOICE_MODEL_NOT_READY': throw new RemoteError('voice/model-not-ready', error.message, details)
        case 'VOICE_UNAVAILABLE':
        case 'VOICE_ENGINE_DEGRADED': throw new RemoteError('voice/unavailable', error.message, details)
        case 'VOICE_MODEL_BUSY': throw new RemoteError('voice/model-busy', error.message, details)
        case 'VOICE_STREAM_UNSUPPORTED': throw new RemoteError('voice/stream-unsupported', error.message, details)
        default: throw new RemoteError('voice/operation-failed', error.message, details)
      }
    }
    throw new RemoteError('voice/operation-failed', 'Voice operation failed; check the local engine and model files', { code: 'VOICE_OPERATION_FAILED' })
  }
}

export default VoiceController
