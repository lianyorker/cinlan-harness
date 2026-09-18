/** Provider-owned model management and recognizer lifetime, shared by all transports. */
import { VoiceError } from '@deepseek-ai/dsh-voice'
import type { VoiceRuntime, VoiceEngineStatus, VoiceModelId, VoiceOperations, VoiceTranscribeRequest } from '@deepseek-ai/dsh-voice'
import { engineRepairHint } from './engine-repair.ts'
import { cancelModelInstallations, ensureModelDownloaded, forgetModel, readModelStatus } from './model-cache.ts'
import type { DownloadOptions, ExtractArchive } from './model-cache.ts'
import { describeSherpaOnnxCause, loadSherpaOnnx, sherpaOnnxLoadCause } from './sherpa-deps.ts'

interface ActiveOperation {
  readonly controller: AbortController
  readonly promise: Promise<unknown>
  readonly modelId?: VoiceModelId
}

/** Operations registered for one provider lifetime; disposal prevents new calls before cancelling work. */
export class SherpaVoiceOperations implements VoiceOperations {
  private readonly lifetime = new AbortController()
  private readonly active = new Set<ActiveOperation>()
  private readonly removing = new Set<VoiceModelId>()

  constructor(
    private readonly voice: VoiceRuntime,
    private readonly extractArchive: ExtractArchive,
    private readonly downloadOptions: DownloadOptions,
  ) {}

  engineStatus(signal: AbortSignal): Promise<VoiceEngineStatus> {
    return this.run(signal, () => {
      const status: VoiceEngineStatus = loadSherpaOnnx() !== null
        ? { ok: true }
        : { ok: false, cause: describeSherpaOnnxCause(sherpaOnnxLoadCause()), ...engineRepairHint() }
      return Promise.resolve(status)
    })
  }

  modelsList(signal: AbortSignal) {
    return this.run(signal, async () => ({
      models: await Promise.all(this.voice.listDefinitions().map(async definition => ({
        definition: {
          id: definition.id, name: definition.name, description: definition.description,
          recommended: definition.recommended, approximateBytes: definition.approximateBytes,
        },
        status: await readModelStatus(definition),
      }))),
    }))
  }

  modelsDownload(modelId: VoiceModelId, signal: AbortSignal) {
    const definition = this.requireModel(modelId)
    return this.run(signal, async operationSignal => ({
      cacheDir: await ensureModelDownloaded(definition, fetch, this.extractArchive, this.downloadOptions, operationSignal),
    }), modelId)
  }

  async modelsRemove(modelId: VoiceModelId, signal: AbortSignal): Promise<void> {
    this.requireModel(modelId)
    signal.throwIfAborted()
    this.removing.add(modelId)
    try {
      await this.run(signal, async (operationSignal) => {
        const active = [...this.active].filter(operation => operation.modelId === modelId)
        for (const operation of active) operation.controller.abort(new DOMException('voice model removed', 'AbortError'))
        await Promise.allSettled(active.map(operation => operation.promise))
        operationSignal.throwIfAborted()
        await forgetModel(modelId)
      })
    } finally {
      this.removing.delete(modelId)
    }
  }

  transcribe(request: VoiceTranscribeRequest, signal: AbortSignal) {
    const definition = this.requireModel(request.modelId)
    return this.run(signal, async (operationSignal) => {
      const status = await readModelStatus(definition)
      operationSignal.throwIfAborted()
      if (status.state !== 'ready') throw new VoiceError(
        'voice model "' + definition.id + '" is not downloaded', 'VOICE_MODEL_NOT_READY',
      )
      const engine = this.voice.engineOrUndefined
      if (engine === undefined) throw new VoiceError('no voice engine is registered', 'VOICE_UNAVAILABLE')
      const recognizer = await engine.loadModel(definition, status.cacheDir)
      try {
        operationSignal.throwIfAborted()
        const text = await recognizer.transcribe(request.samples)
        operationSignal.throwIfAborted()
        return { text }
      } finally {
        recognizer.dispose()
      }
    }, request.modelId)
  }

  /** Abort owned operations and wait for downloads, file reads, and native recognizers to settle. */
  async dispose(): Promise<void> {
    this.lifetime.abort(new DOMException('voice provider disposed', 'AbortError'))
    await cancelModelInstallations(this.voice.listDefinitions().map(definition => definition.id))
    await Promise.allSettled([...this.active].map(operation => operation.promise))
  }

  private requireModel(modelId: VoiceModelId) {
    if (this.removing.has(modelId)) throw new VoiceError('voice model removal is in progress', 'VOICE_MODEL_BUSY')
    return this.voice.requireDefinition(modelId)
  }

  private run<T>(signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>, modelId?: VoiceModelId): Promise<T> {
    const controller = new AbortController()
    const operationSignal = AbortSignal.any([signal, this.lifetime.signal, controller.signal])
    operationSignal.throwIfAborted()
    const promise = Promise.resolve().then(async () => {
      operationSignal.throwIfAborted()
      const result = await work(operationSignal)
      operationSignal.throwIfAborted()
      return result
    })
    const operation = { controller, promise, ...(modelId === undefined ? {} : { modelId }) }
    this.active.add(operation)
    void promise.then(() => { this.active.delete(operation) }, () => { this.active.delete(operation) })
    return promise
  }
}
