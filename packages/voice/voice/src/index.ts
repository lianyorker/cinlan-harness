/**
 * Provider-neutral Service Definition for local voice-dictation transcription.
 * The Provider owns native-engine loading, model download/cache, and
 * inference; Consumers (the settings page's model list, the Ctrl+Shift+E dictation
 * client route) own permission policy, presentation, and composer insertion.
 * @module @cinlan/voice
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type {
  VoiceEngine,
  VoiceModelDefinition,
  VoiceModelId as VoiceModelIdValue,
  VoiceOperations,
  VoiceEngineStatus,
  VoiceModelsListValue,
  VoiceModelRow,
  VoiceModelsDownloadValue,
  VoiceModelTask,
  VoiceModelTaskId,
  VoiceModelsCancelValue,
  VoiceTranscribeRequest,
  VoiceTranscribeResult,
  VoiceModelId as VoiceModelIdType,
  VoiceAudioChunk,
  VoiceTranscriptFrame,
} from './types.ts'

export type * from './types.ts'
export { architectureFilePaths } from './architecture.ts'

/** Exact shipped model selector. */
export type VoiceModelId = VoiceModelIdValue

/**
 * Brand one shipped model id.
 * @param value Exact model definition id.
 * @returns Branded model id.
 */
export function VoiceModelId(value: string): VoiceModelId {
  return value as VoiceModelId
}

/** Typed voice-dictation failure with a machine-routable open-string code. */
export class VoiceError extends HarnessError {}

declare module '@deepseek-ai/cordis' {
  interface Context {
    voice: VoiceRuntime
  }
}

/** Registry for one local engine and model-specific local or cloud operations. */
export class VoiceRuntime extends Service {
  private readonly operations: VoiceOperations[] = []
  private engine: VoiceEngine | undefined
  private readonly models = new Map<string, VoiceModelDefinition>()

  /** Create the provider-neutral voice runtime. */
  constructor(ctx: Context) {
    super(ctx, 'voice')
  }

  /**
   * Register one provider's management and transcription operations.
   * @param operations - Provider-owned callbacks, independent of transport.
   * @returns Disposer that immediately prevents new calls to this provider.
   */
  registerOperations(operations: VoiceOperations): () => void {
    if (this.operations.includes(operations)) throw new VoiceError('voice operations are already registered', 'VOICE_OPERATIONS_DUPLICATE')
    for (const definition of this.models.values()) {
      if (operations.supportsModel(definition) && this.operations.some(candidate => candidate.supportsModel(definition))) {
        throw new VoiceError(`multiple providers own voice model '${definition.id}'`, 'VOICE_OPERATIONS_DUPLICATE')
      }
    }
    this.operations.push(operations)
    return () => {
      const index = this.operations.indexOf(operations)
      if (index >= 0) this.operations.splice(index, 1)
    }
  }

  private requireOperations(signal: AbortSignal, modelId?: VoiceModelId): VoiceOperations {
    signal.throwIfAborted()
    if (this.operations.length === 0) throw new VoiceError('no voice provider is available', 'VOICE_UNAVAILABLE')
    if (modelId === undefined) return this.operations[0] as VoiceOperations
    const definition = this.requireDefinition(modelId)
    const provider = this.operations.find(candidate => candidate.supportsModel(definition))
    if (provider === undefined) throw new VoiceError(`no provider owns voice model '${modelId}'`, 'VOICE_UNAVAILABLE')
    return provider
  }

  /**
   * Read the provider's native engine status.
   * @param signal - Caller cancellation.
   * @returns Availability and repair guidance; rejects when no provider is mounted.
   */
  engineStatus(signal: AbortSignal): Promise<VoiceEngineStatus> {
    const local = this.listDefinitions().find(definition => definition.provider !== 'openai')
    return this.requireOperations(signal, local?.id).engineStatus(signal)
  }

  /**
   * Read display metadata and current installation state.
   * @param signal - Caller cancellation.
   * @returns The provider's model roster.
   */
  modelsList(signal: AbortSignal): Promise<VoiceModelsListValue> {
    this.requireOperations(signal)
    return Promise.all(this.operations.map(provider => provider.modelsList(signal)))
      .then(values => ({ models: values.flatMap(value => value.models) }))
  }

  /**
   * Admit a Host-owned download independent of transport lifetime.
   * @param modelId - Registered model identity.
   * @param signal - Admission cancellation; disconnect after admission does not cancel the task.
   * @returns Task receipt; poll modelsList for progress and terminal state.
   */
  modelsDownload(modelId: VoiceModelId, signal: AbortSignal): Promise<VoiceModelsDownloadValue> {
    return this.requireOperations(signal, modelId).modelsDownload(modelId, signal)
  }

  /**
   * Reinstall the current pinned manifest while retaining the usable installation.
   * @param modelId - Registered model identity.
   * @param signal - Admission cancellation only.
   * @returns Host task receipt.
   */
  modelsReinstall(modelId: VoiceModelId, signal: AbortSignal): Promise<VoiceModelTask> {
    return this.requireOperations(signal, modelId).modelsReinstall(modelId, signal)
  }

  /**
   * Update to the pinned manifest when its fingerprint differs.
   * @param modelId - Registered model identity.
   * @param signal - Admission cancellation only.
   * @returns Host task receipt, including immediate success when already current.
   */
  modelsUpdate(modelId: VoiceModelId, signal: AbortSignal): Promise<VoiceModelTask> {
    return this.requireOperations(signal, modelId).modelsUpdate(modelId, signal)
  }

  /**
   * Cancel exactly one running Host task and await its cleanup.
   * @param modelId - Registered model identity.
   * @param taskId - Identity returned by task admission or modelsList.
   * @param signal - Cancellation before admission; accepted cancellation joins the task.
   * @returns Whether this call cancelled the matching running task.
   */
  modelsCancel(modelId: VoiceModelId, taskId: VoiceModelTaskId, signal: AbortSignal): Promise<VoiceModelsCancelValue> {
    return this.requireOperations(signal, modelId).modelsCancel(modelId, taskId, signal)
  }

  /**
   * Cancel model work and remove its cache after resources settle.
   * @param modelId - Registered model identity.
   * @param signal - Caller cancellation before deletion begins.
   */
  modelsRemove(modelId: VoiceModelId, signal: AbortSignal): Promise<void> {
    return this.requireOperations(signal, modelId).modelsRemove(modelId, signal)
  }

  /** Import a user model through the provider that owns local resources.
   * @param sourcePath - Absolute Host directory containing clh-voice-model.json.
   * @param signal - Cancels copying and verification before publication.
   * @returns Published model row; the provider retains the managed copy across reloads.
   */
  modelsImport(sourcePath: string, signal: AbortSignal): Promise<VoiceModelRow> {
    signal.throwIfAborted()
    const provider = this.operations.find(candidate => candidate.modelsImport !== undefined)
    if (provider?.modelsImport === undefined) throw new VoiceError('voice model import is unavailable', 'VOICE_UNAVAILABLE')
    return provider.modelsImport(sourcePath, signal)
  }

  /**
   * Transcribe decoded audio with the installed model.
   * @param request - Model identity and 16kHz mono float32 samples.
   * @param signal - Caller cancellation; native calls settle before resources release.
   * @returns Transcript after recognizer disposal.
   */
  transcribe(request: VoiceTranscribeRequest, signal: AbortSignal): Promise<VoiceTranscribeResult> {
    return this.requireOperations(signal, request.modelId).transcribe(request, signal)
  }

  /**
   * Stream decoded 16kHz mono PCM through a ready online model.
   * @param modelId - exact model identity from the registered catalog.
   * @param chunks - bounded canonical base64 PCM chunks from the Client uplink.
   * @param signal - cancels recognition and waits for provider cleanup when iteration returns.
   * @returns partial hypotheses and one final transcript.
   */
  transcribeStream(
    modelId: VoiceModelIdType,
    chunks: AsyncIterable<VoiceAudioChunk>,
    signal: AbortSignal,
  ): AsyncIterable<VoiceTranscriptFrame> {
    return this.requireOperations(signal, modelId).transcribeStream(modelId, chunks, signal)
  }

  /**
   * Register the local engine implementation for the calling plugin lifetime.
   * A second registration throws: exactly one engine may be mounted.
   * @param engine - the local speech-to-text engine implementation.
   * @returns disposer removing the engine registration.
   */
  registerEngine(engine: VoiceEngine): () => void {
    if (this.engine !== undefined) {
      throw new VoiceError(`a voice engine ('${this.engine.id}') is already registered`, 'VOICE_ENGINE_DUPLICATE')
    }
    this.engine = engine
    return () => {
      if (this.engine === engine) this.engine = undefined
    }
  }

  /**
   * Register one shipped model definition for the calling plugin lifetime.
   * Duplicate ids throw: model identity is a composition-level contract.
   * @param definition - the model's display metadata and download source.
   * @returns disposer removing the model registration.
   */
  registerModel(definition: VoiceModelDefinition): () => void {
    if (this.models.has(definition.id)) {
      throw new VoiceError(`voice model '${definition.id}' is already registered`, 'VOICE_MODEL_DUPLICATE')
    }
    if (this.operations.filter(candidate => candidate.supportsModel(definition)).length > 1) {
      throw new VoiceError(`multiple providers own voice model '${definition.id}'`, 'VOICE_OPERATIONS_DUPLICATE')
    }
    this.models.set(definition.id, definition)
    return () => { this.models.delete(definition.id) }
  }

  /**
   * The engine implementation, or undefined while no Provider is mounted
   * (degraded mode; the settings page shows the composition guidance instead
   * of a model list).
   */
  get engineOrUndefined(): VoiceEngine | undefined {
    return this.engine
  }

  /**
   * List every registered model definition in registration order.
   * @returns the shipped model roster.
   */
  listDefinitions(): readonly VoiceModelDefinition[] {
    return [...this.models.values()]
  }

  /**
   * Resolve one registered model definition.
   * @param modelId - exact model id.
   * @returns the definition.
   * @throws {VoiceError} VOICE_MODEL_UNKNOWN when no such model is registered.
   */
  requireDefinition(modelId: VoiceModelId): VoiceModelDefinition {
    const definition = this.models.get(modelId)
    if (definition === undefined) throw new VoiceError(`unknown voice model '${modelId}'`, 'VOICE_MODEL_UNKNOWN')
    return definition
  }
}

export default VoiceRuntime
