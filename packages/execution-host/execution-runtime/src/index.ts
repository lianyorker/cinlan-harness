/** Host-owned remote runtime tasks and atomic saved-target activation. */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-execution-host-targets'
import { z } from 'zod'
import { Config } from './config.ts'
import { RuntimeError } from './errors.ts'
export { RuntimeError } from './errors.ts'
import { readRuntimeArtifact } from './artifact.ts'
import { RuntimeConnectionError, runRemoteOperation } from './transport.ts'
import type {
  RuntimeGeneration, RuntimeInspection, RuntimeInstallation, RuntimeInstallRequest, RuntimeLocation,
  RuntimeStartRequest, RuntimeTask, RuntimeTaskId, RuntimeTaskRequest, RuntimeTasksValue, RuntimeTaskValue,
} from './types.ts'
export type * from './types.ts'
export { Config } from './config.ts'

declare module '@deepseek-ai/cordis' { interface Context { executionRuntimes: ExecutionRuntimes } }
const remotePath = z.string().startsWith('/').refine(value => !/[\0\r\n]/u.test(value) && posix.normalize(value) === value)
const locationSchema = z.object({
  endpoint: z.object({ host: z.string().min(1), port: z.number().int().min(1).max(65535), username: z.string().min(1),
    privateKeyFile: z.string().refine(isAbsolute), hostKeySHA256: z.string().regex(/^[0-9a-f]{64}$/u) }).strict(),
  node: remotePath, installRoot: remotePath, workspace: remotePath,
}).strict()
interface Task {
  view: RuntimeTask
  readonly controller: AbortController
  done: Promise<void>
  readonly listeners: Set<() => void>
}

/** One controller Host owns provisioning; observers never own its cancellation. */
export default class ExecutionRuntimes extends Service {
  static inject = ['executionHostTargets']
  static Config = Config
  private readonly tasks = new Map<RuntimeTaskId, Task>()
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'executionRuntimes')
    if ((config.artifactDirectory === undefined) !== (config.manifestSHA256 === undefined)) throw new Error('Runtime artifact directory and SHA-256 must be paired')
    if (config.artifactDirectory !== undefined && !isAbsolute(config.artifactDirectory)) throw new Error('Runtime artifact directory must be absolute')
    if (config.manifestSHA256 !== undefined && !/^[0-9a-f]{64}$/u.test(config.manifestSHA256)) throw new Error('Invalid runtime manifest SHA-256')
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) throw new Error('Invalid runtime limit: ' + key)
    }
    if (config.operationTimeoutMs > 2147483647 || config.shutdownTimeoutMs > 2147483647) throw new Error('Runtime timeout exceeds Node timer limit')
    ctx.effect(() => async () => {
      this.lifetime.abort(new Error('Runtime installer disposed'))
      for (const task of this.tasks.values()) task.controller.abort(this.lifetime.signal.reason)
      await Promise.allSettled([...this.pending, ...[...this.tasks.values()].map(task => task.done)])
      this.tasks.clear()
    })
  }

  private async artifact(location: RuntimeLocation, signal: AbortSignal) {
    if (this.config.artifactDirectory !== undefined && this.config.manifestSHA256 !== undefined) {
      return await readRuntimeArtifact(this.config.artifactDirectory, this.config.manifestSHA256, this.config)
    }
    const machine = await runRemoteOperation(location, '0'.repeat(64) as RuntimeGeneration, this.config, undefined, signal)
    const root = fileURLToPath(new URL('../assets/releases/', import.meta.url))
    let releaseIndex: string
    try { releaseIndex = await readFile(join(root, 'index.json'), 'utf8') }
    catch { throw new RuntimeError('release-unavailable') }
    const index = z.object({ schemaVersion: z.literal(1), releases: z.record(z.string(), z.object({
      directory: z.string().regex(/^[a-z0-9-]+$/u),
      manifestSHA256: z.string().regex(/^[0-9a-f]{64}$/u) }).strict()) }).strict().parse(JSON.parse(releaseIndex))
    const selected = index.releases[machine.platform + '-' + machine.arch]
    if (selected === undefined) throw new RuntimeError('release-unavailable')
    return await readRuntimeArtifact(join(root, selected.directory), selected.manifestSHA256, this.config)
  }

  /**
   * Check the shipped generation through a pinned SSH identity and explicit remote Node.
   * @param request - Deployment coordinates; no ambient credentials are used.
   * @param signal - Cancels this read-only observation.
   * @returns Missing or fully verified installed generation and actual Node information.
   */
  detect(request: RuntimeLocation, signal?: AbortSignal): Promise<RuntimeInspection> {
    const parsed = locationSchema.safeParse(request)
    if (!parsed.success) throw new RuntimeError('invalid-config')
    const location = parsed.data
    const operation = (async () => {
      const admission = AbortSignal.any([
        this.lifetime.signal, AbortSignal.timeout(this.config.operationTimeoutMs), ...(signal === undefined ? [] : [signal]),
      ])
      admission.throwIfAborted()
      const artifact = await this.artifact(location, admission)
      return await runRemoteOperation(location, artifact.generation, this.config, undefined, admission)
    })()
    return this.track(operation.catch((error: unknown) => {
      if (error instanceof RuntimeError) throw error
      if (signal?.aborted) throw new RuntimeError('cancelled')
      if (error instanceof RuntimeConnectionError) throw new RuntimeError('connection-failed')
      throw new RuntimeError('verification-failed')
    }))
  }

  /**
   * Capture an explicit installation as a Host-owned task and return immediately.
   * @param request - Exact target revision and deployment coordinates.
   * @returns Redacted task receipt; closing a Client does not cancel it.
   */
  start(request: RuntimeStartRequest): RuntimeTaskValue {
    this.lifetime.signal.throwIfAborted()
    const parsedOperation = z.enum(['install', 'update']).safeParse(request.operation)
    if (!parsedOperation.success) throw new RuntimeError('invalid-config')
    const operation = parsedOperation.data
    const target = this.ctx.executionHostTargets.list().targets.find(value => value.id === request.target.id)
    if (target === undefined || target.revision !== request.target.revision) throw new RuntimeError('target-changed')
    if ((target.execution === undefined) !== (operation === 'install')) throw new Error('Choose install for an empty target or update for a configured target')
    const parsedLocation = locationSchema.safeParse({
      endpoint: request.endpoint, node: request.node, installRoot: request.installRoot, workspace: request.workspace,
    })
    if (!parsedLocation.success) throw new RuntimeError('invalid-config')
    const location = parsedLocation.data
    if ([...this.tasks.values()].some(task => task.view.target.id === target.id && task.view.state === 'running')) throw new Error('Target already has a running installation')
    if (this.tasks.size >= this.config.maxRetainedTasks) {
      const completed = [...this.tasks].find(([, task]) => task.view.state !== 'running')
      if (completed === undefined) throw new Error('Runtime task limit reached')
      this.tasks.delete(completed[0])
    }
    const id = randomUUID() as RuntimeTaskId
    const controller = new AbortController()
    const view: RuntimeTask = { id, target: { id: target.id, revision: target.revision }, operation, state: 'running', startedAt: new Date().toISOString() }
    const listeners = new Set<() => void>()
    const task: Task = { view, controller, listeners, done: Promise.resolve() }
    this.tasks.set(id, task)
    const done = Promise.resolve().then(async () => {
      try {
        const result = await this.installOnce({ ...location, target: view.target }, controller.signal)
        task.view = { ...view, state: 'succeeded', result, completedAt: new Date().toISOString() }
      } catch (error) {
        task.view = { ...view, state: controller.signal.aborted ? 'cancelled' : 'failed',
          error: (error instanceof RuntimeError ? error : new RuntimeError(controller.signal.aborted ? 'cancelled'
            : error instanceof RuntimeConnectionError ? 'connection-failed' : 'verification-failed')).message,
          completedAt: new Date().toISOString() }
      } finally { for (const listener of listeners) listener() }
    })
    task.done = done
    return { task: structuredClone(view) }
  }

  private async installOnce(request: RuntimeInstallRequest, signal: AbortSignal): Promise<RuntimeInstallation> {
    const admission = AbortSignal.any([this.lifetime.signal, signal, AbortSignal.timeout(this.config.operationTimeoutMs)])
    admission.throwIfAborted()
    const artifact = await this.artifact(request, admission)
    const runtime = await runRemoteOperation(request, artifact.generation, this.config, artifact, admission)
    admission.throwIfAborted()
    if (runtime.state !== 'installed' || runtime.helper === undefined || runtime.helperHash === undefined
        || runtime.bootstrapPath === undefined || runtime.bootstrapHash === undefined) throw new Error('Remote runtime did not verify every required entry')
    const value = await this.ctx.executionHostTargets.activateExecution(request.target, {
      endpoint: request.endpoint, node: request.node, workspace: request.workspace,
      helper: runtime.helper, helperHash: runtime.helperHash, bootstrapPath: runtime.bootstrapPath, bootstrapHash: runtime.bootstrapHash,
    }, admission).catch(() => {
      throw new RuntimeError(admission.aborted ? 'cancelled' : 'target-changed')
    })
    // The successful target CAS is the commit point, even if cancellation arrives while persistence completes.
    const { execution: _execution, ...target } = value.target
    return { target, runtime }
  }

  /**
   * Read a retained task without extending its execution authority.
   * @param request - Exact Host-issued task identity.
   * @returns Redacted immutable snapshot.
   */
  get(request: RuntimeTaskRequest): RuntimeTaskValue { return { task: structuredClone(this.requireTask(request).view) } }

  /**
   * Read the bounded task inventory retained by this Host process for reconnecting Clients.
   * @returns Redacted task snapshots.
   */
  listTasks(): RuntimeTasksValue { return { tasks: [...this.tasks.values()].map(task => structuredClone(task.view)) } }

  /**
   * Observe a task; observer cancellation only detaches this stream.
   * @param request - Exact Host-issued task identity.
   * @param signal - Read-only subscription lifetime.
   * @returns Initial and settled task observations.
   */
  async *follow(request: RuntimeTaskRequest, signal?: AbortSignal): AsyncGenerator<RuntimeTaskValue, void> {
    const task = this.requireTask(request)
    const terminal = Promise.withResolvers<void>()
    const wake = (): void => { terminal.resolve() }
    task.listeners.add(wake)
    signal?.addEventListener('abort', wake, { once: true })
    try {
      signal?.throwIfAborted()
      const initial = structuredClone(task.view)
      yield { task: initial }
      if (initial.state !== 'running') return
      if (task.view.state === 'running') await terminal.promise
      signal?.throwIfAborted()
      yield { task: structuredClone(task.view) }
    } finally { task.listeners.delete(wake); signal?.removeEventListener('abort', wake) }
  }

  /**
   * Cancel only the specified Host task and await its publication/cleanup outcome.
   * @param request - Exact Host-issued task identity.
   * @returns Settled outcome; an already committed activation remains succeeded.
   */
  async cancel(request: RuntimeTaskRequest): Promise<RuntimeTaskValue> {
    const task = this.requireTask(request)
    if (task.view.state === 'running') task.controller.abort(new Error('Runtime installation cancelled'))
    await task.done
    return { task: structuredClone(task.view) }
  }

  private requireTask(request: RuntimeTaskRequest): Task {
    const task = this.tasks.get(request.id)
    if (task === undefined) throw new Error('Runtime task is not retained by this Host')
    return task
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation)
    void operation.then(() => { this.pending.delete(operation) }, () => { this.pending.delete(operation) })
    return operation
  }
}
