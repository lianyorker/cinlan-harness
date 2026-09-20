/** Host-owned model tasks and recognizer lifetimes shared by authenticated transports. */
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { VoiceError } from '@deepseek-ai/dsh-voice'
import type {
  VoiceRuntime, VoiceEngineStatus, VoiceModelId, VoiceModelTaskId, VoiceModelTask,
  VoiceModelOperation, VoiceModelStatus, VoiceOperations, VoiceTranscribeRequest,
} from '@deepseek-ai/dsh-voice'
import { engineRepairHint } from './engine-repair.ts'
import { downloadModelToStaging } from './model-cache.ts'
import type { DownloadOptions, ExtractArchive } from './model-cache.ts'
import { VoiceResourceNotReadyError, VoiceResourceStore } from './resource-store.ts'
import type { ResourceStoreOptions } from './resource-store.ts'
import { describeSherpaOnnxCause, loadSherpaOnnx, sherpaOnnxLoadCause } from './sherpa-deps.ts'

interface ActiveOperation {
  readonly controller: AbortController
  readonly promise: Promise<unknown>
  readonly modelId?: VoiceModelId
}
interface ModelTask {
  snapshot: VoiceModelTask
  readonly controller: AbortController
  readonly done: Promise<void>
}

/** One mounted provider owns its task identities; durable generations are shared across Hosts. */
export class SherpaVoiceOperations implements VoiceOperations {
  private readonly lifetime = new AbortController()
  private readonly active = new Set<ActiveOperation>()
  private readonly removing = new Set<VoiceModelId>()
  private readonly tasks = new Map<VoiceModelId, ModelTask>()
  private readonly store: VoiceResourceStore

  constructor(
    private readonly voice: VoiceRuntime,
    private readonly extractArchive: ExtractArchive,
    private readonly downloadOptions: DownloadOptions,
    private readonly cacheRoot: string,
    storeOptions: ResourceStoreOptions,
  ) {
    this.store = new VoiceResourceStore(cacheRoot, storeOptions)
  }

  engineStatus(signal: AbortSignal): Promise<VoiceEngineStatus> {
    return this.run(signal, () => {
      const status: VoiceEngineStatus = loadSherpaOnnx() !== null
        ? { ok: true }
        : { ok: false, cause: describeSherpaOnnxCause(sherpaOnnxLoadCause()), ...engineRepairHint() }
      return Promise.resolve(status)
    })
  }

  modelsList(signal: AbortSignal) {
    return this.run(signal, async operationSignal => ({
      models: await Promise.all(this.voice.listDefinitions().map(async (definition) => {
        const { cacheDir, ...resource } = await this.store.inspect(definition, operationSignal)
        const task = this.tasks.get(definition.id)?.snapshot ?? null
        let status: VoiceModelStatus = { state: 'not-downloaded' }
        if (resource.integrity === 'verified' && cacheDir !== undefined) status = { state: 'ready', cacheDir }
        else if (task?.state === 'running' && task.progress !== undefined) status = task.progress
        else if (task?.state === 'failed' && task.error !== undefined) status = { state: 'failed', message: task.error.message }
        return {
          definition: {
            id: definition.id, name: definition.name, description: definition.description,
            recommended: definition.recommended, approximateBytes: definition.approximateBytes,
          },
          resource, task, status,
        }
      })),
    }))
  }

  modelsDownload(modelId: VoiceModelId, signal: AbortSignal) {
    return this.startTask(modelId, 'download', signal)
  }

  modelsReinstall(modelId: VoiceModelId, signal: AbortSignal) {
    return this.startTask(modelId, 'reinstall', signal)
  }

  modelsUpdate(modelId: VoiceModelId, signal: AbortSignal) {
    return this.startTask(modelId, 'update', signal)
  }

  async modelsCancel(modelId: VoiceModelId, taskId: VoiceModelTaskId, signal: AbortSignal) {
    this.requireModel(modelId)
    signal.throwIfAborted()
    this.lifetime.signal.throwIfAborted()
    const task = this.tasks.get(modelId)
    if (task?.snapshot.taskId !== taskId || task.snapshot.state !== 'running' || task.controller.signal.aborted) {
      return { cancelled: false }
    }
    task.controller.abort(new DOMException('voice task cancelled', 'AbortError'))
    await task.done
    return { cancelled: true }
  }

  async modelsRemove(modelId: VoiceModelId, signal: AbortSignal): Promise<void> {
    const definition = this.requireModel(modelId)
    signal.throwIfAborted()
    this.removing.add(modelId)
    try {
      await this.run(signal, async (operationSignal) => {
        const observed = await this.store.inspect(definition, operationSignal)
        const task = this.tasks.get(modelId)
        if (task?.snapshot.state === 'running') {
          task.controller.abort(new DOMException('voice model removed', 'AbortError'))
          await task.done
        }
        const active = [...this.active].filter(operation => operation.modelId === modelId)
        for (const operation of active) operation.controller.abort(new DOMException('voice model removed', 'AbortError'))
        await Promise.allSettled(active.map(operation => operation.promise))
        operationSignal.throwIfAborted()
        if (!await this.store.remove(definition, observed.revision, operationSignal)) {
          throw new VoiceError('voice installation changed on another Host', 'VOICE_RESOURCE_CONFLICT')
        }
        this.tasks.delete(modelId)
      })
    } finally {
      this.removing.delete(modelId)
    }
  }

  transcribe(request: VoiceTranscribeRequest, signal: AbortSignal) {
    const definition = this.requireModel(request.modelId)
    return this.run(signal, async (operationSignal) => {
      const lease = await this.store.acquire(definition, operationSignal).catch((error: unknown) => {
        if (error instanceof VoiceResourceNotReadyError) throw new VoiceError('voice model files are not verified', 'VOICE_MODEL_NOT_READY')
        throw error
      })
      try {
        operationSignal.throwIfAborted()
        const engine = this.voice.engineOrUndefined
        if (engine === undefined) throw new VoiceError('no voice engine is registered', 'VOICE_UNAVAILABLE')
        const recognizer = await engine.loadModel(lease.definition, lease.cacheDir)
        try {
          operationSignal.throwIfAborted()
          const text = await recognizer.transcribe(request.samples)
          operationSignal.throwIfAborted()
          return { text }
        } finally {
          recognizer.dispose()
        }
      } finally {
        await lease.release()
      }
    }, request.modelId)
  }

  /** Abort and join this Host's tasks and native recognizers before provider disposal settles. */
  async dispose(): Promise<void> {
    this.lifetime.abort(new DOMException('voice provider disposed', 'AbortError'))
    await Promise.allSettled([
      ...[...this.active].map(operation => operation.promise),
      ...[...this.tasks.values()].map(task => task.done),
    ])
  }

  private startTask(modelId: VoiceModelId, operation: VoiceModelOperation, signal: AbortSignal): Promise<VoiceModelTask> {
    const definition = this.requireModel(modelId)
    signal.throwIfAborted()
    this.lifetime.signal.throwIfAborted()
    const current = this.tasks.get(modelId)
    if (current?.snapshot.state === 'running') return Promise.resolve(current.snapshot)
    return this.run(signal, async (admissionSignal) => {
      const resource = await this.store.inspect(definition, admissionSignal)
      admissionSignal.throwIfAborted()
      this.requireModel(modelId)
      const admitted = this.tasks.get(modelId)
      if (admitted?.snapshot.state === 'running') return admitted.snapshot
      return this.admitTask(definition, operation, resource)
    })
  }

  private admitTask(
    definition: import('@deepseek-ai/dsh-voice').VoiceModelDefinition,
    operation: VoiceModelOperation,
    resource: import('./resource-store.ts').ResourceInspection,
  ): VoiceModelTask {
    const modelId = definition.id
    const controller = new AbortController()
    const taskSignal = AbortSignal.any([this.lifetime.signal, controller.signal])
    const taskId = randomUUID() as VoiceModelTaskId
    const snapshot: VoiceModelTask = { taskId, modelId, operation, state: 'running' }
    const staging = join(this.cacheRoot, '.tasks', taskId)
    const done = Promise.resolve().then(async () => {
      let terminal: VoiceModelTask
      try {
        taskSignal.throwIfAborted()
        const current = resource.integrity === 'verified' && resource.installedVersion === resource.availableVersion
        if (operation === 'reinstall' || !current) {
          await mkdir(staging, { recursive: true })
          await downloadModelToStaging(definition, staging, fetch, this.extractArchive, this.downloadOptions, taskSignal,
            (progress) => { task.snapshot = { ...task.snapshot, progress } })
          await this.store.prepare(definition, staging, taskSignal)
          if (!await this.store.commit(definition, staging, resource.revision, taskSignal)) {
            throw new VoiceError('voice installation changed on another Host', 'VOICE_RESOURCE_CONFLICT')
          }
        }
        terminal = { taskId, modelId, operation, state: 'succeeded' }
      } catch (error) {
        terminal = taskSignal.aborted
          ? { taskId, modelId, operation, state: 'cancelled' }
          : { taskId, modelId, operation, state: 'failed', error: safeTaskError(error) }
      } finally {
        await rm(staging, { recursive: true, force: true })
      }
      task.snapshot = terminal
    }).catch(() => {
      task.snapshot = { taskId, modelId, operation, state: 'failed', error: {
        code: 'VOICE_CLEANUP_FAILED', message: 'Voice task cleanup failed; check local storage.',
      } }
    })
    const task: ModelTask = { snapshot, controller, done }
    this.tasks.set(modelId, task)
    return snapshot
  }

  private requireModel(modelId: VoiceModelId) {
    if (this.removing.has(modelId)) throw new VoiceError('voice model removal is in progress', 'VOICE_MODEL_BUSY')
    return this.voice.requireDefinition(modelId)
  }

  private run<T>(signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>, modelId?: VoiceModelId): Promise<T> {
    const controller = new AbortController()
    const operationSignal = AbortSignal.any([signal, this.lifetime.signal, controller.signal])
    operationSignal.throwIfAborted()
    const promise = Promise.resolve().then(() => {
      operationSignal.throwIfAborted()
      return work(operationSignal)
    })
    const operation = { controller, promise, ...(modelId === undefined ? {} : { modelId }) }
    this.active.add(operation)
    void promise.then(() => { this.active.delete(operation) }, () => { this.active.delete(operation) })
    return promise
  }
}

function safeTaskError(error: unknown): { code: string; message: string } {
  if (error instanceof VoiceError && error.code === 'VOICE_RESOURCE_CONFLICT') {
    return { code: 'VOICE_RESOURCE_CONFLICT', message: 'The model changed on another Host. Refresh and retry.' }
  }
  return { code: 'VOICE_INSTALL_FAILED', message: 'Voice model installation failed. Check the source and local storage, then retry.' }
}
