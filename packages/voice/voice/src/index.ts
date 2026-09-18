/**
 * Provider-neutral Service Definition for local voice-dictation transcription.
 * The Provider owns native-engine loading, model download/cache, and
 * inference; Consumers (the settings page's model list, the Ctrl+Shift+E dictation
 * client route) own permission policy, presentation, and composer insertion.
 * @module @deepseek-ai/dsh-voice
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
  VoiceModelsDownloadValue,
  VoiceTranscribeRequest,
  VoiceTranscribeResult,
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

/**
 * Registry and execution facade for the local voice-dictation engine. Exactly
 * one Provider may register (a swappable-multi-provider seam like
 * mobile-device's is not needed today: there is one embedded local engine,
 * not several competing backends a deployment chooses between at runtime).
 */
export class VoiceRuntime extends Service {
  private operations: VoiceOperations | undefined
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
    if (this.operations !== undefined) throw new VoiceError('voice operations are already registered', 'VOICE_OPERATIONS_DUPLICATE')
    this.operations = operations
    return () => { if (this.operations === operations) this.operations = undefined }
  }

  private requireOperations(signal: AbortSignal): VoiceOperations {
    signal.throwIfAborted()
    if (this.operations === undefined) throw new VoiceError('no voice provider is available', 'VOICE_UNAVAILABLE')
    return this.operations
  }

  /**
   * Read the provider's native engine status.
   * @param signal - Caller cancellation.
   * @returns Availability and repair guidance; rejects when no provider is mounted.
   */
  engineStatus(signal: AbortSignal): Promise<VoiceEngineStatus> {
    return this.requireOperations(signal).engineStatus(signal)
  }

  /**
   * Read display metadata and current installation state.
   * @param signal - Caller cancellation.
   * @returns The provider's model roster.
   */
  modelsList(signal: AbortSignal): Promise<VoiceModelsListValue> {
    return this.requireOperations(signal).modelsList(signal)
  }

  /**
   * Download or await one model's shared installation.
   * @param modelId - Registered model identity.
   * @param signal - Cancellation of the shared installation.
   * @returns Ready cache directory after all installation work settles.
   */
  modelsDownload(modelId: VoiceModelId, signal: AbortSignal): Promise<VoiceModelsDownloadValue> {
    return this.requireOperations(signal).modelsDownload(modelId, signal)
  }

  /**
   * Cancel model work and remove its cache after resources settle.
   * @param modelId - Registered model identity.
   * @param signal - Caller cancellation before deletion begins.
   */
  modelsRemove(modelId: VoiceModelId, signal: AbortSignal): Promise<void> {
    return this.requireOperations(signal).modelsRemove(modelId, signal)
  }

  /**
   * Transcribe decoded audio with the installed model.
   * @param request - Model identity and 16kHz mono float32 samples.
   * @param signal - Caller cancellation; native calls settle before resources release.
   * @returns Transcript after recognizer disposal.
   */
  transcribe(request: VoiceTranscribeRequest, signal: AbortSignal): Promise<VoiceTranscribeResult> {
    return this.requireOperations(signal).transcribe(request, signal)
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
