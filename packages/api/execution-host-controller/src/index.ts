/** Authenticated management of saved SSH targets over the shared Remote carrier. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, remoteErrorOf, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { ExecutionTargetError } from '@deepseek-ai/dsh-execution-host-targets'
import type {} from '@deepseek-ai/dsh-api-gateway'
import { RuntimeError } from '@deepseek-ai/dsh-execution-runtime'
import type { RuntimeInspection, RuntimeLocation, RuntimeStartRequest, RuntimeTaskRequest, RuntimeTasksValue, RuntimeTaskValue } from './types.ts'
import type {
  CreateTargetRequest, InspectDirectoryRequest, InspectionValue, ListTargetsValue,
  TargetRequest, TargetRevisionRequest, TargetValue, UpdateTargetRequest,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { executionHostController: ExecutionHostController }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'execution-host/invalid-request': {}
    'execution-host/not-found': {}
    'execution-host/conflict': {}
    'execution-host/limit-reached': {}
    'execution-host/roots-unconfigured': {}
    'execution-host/ssh-unavailable': {}
    'execution-host/authentication-required': {}
    'execution-host/host-key-mismatch': {}
    'execution-host/unreachable': {}
    'execution-host/incompatible': {}
    'execution-host/cancelled': {}
    'execution-host/timeout': {}
    'execution-host/connection-lost': {}
    'execution-host/outcome-unconfirmed': {}
    'execution-host/inspection-failed': {}
    'execution-host/closed': {}
    'execution-host/local-access-required': {}
    'execution-host/runtime-unavailable': {}
    'execution-runtime/release-unavailable': {}
    'execution-runtime/invalid-config': {}
    'execution-runtime/connection-failed': {}
    'execution-runtime/verification-failed': {}
    'execution-runtime/target-changed': {}
    'execution-runtime/cancelled': {}
  }
}

/** Remote operations consumed by native execution-host settings. */
export default class ExecutionHostController extends TypertRemoteService {
  static inject = ['typert', 'executionHostTargets']
  private readonly lifetime = new AbortController()

  constructor(ctx: Context) {
    super(ctx, 'executionHostController', { namespace: 'executionHosts' })
    ctx.effect(() => () => { this.lifetime.abort() }, 'execution-host management streams')
  }

  /**
   * Read saved targets and current connection observations.
   * @param signal Carrier cancellation before the read.
   * @returns the complete management snapshot.
   */
  @Remote
  list(signal: AbortSignal): Promise<ListTargetsValue> {
    return this.invoke(signal, () => this.ctx.executionHostTargets.list())
  }

  /**
   * Subscribe before the initial snapshot and coalesce subsequent observations.
   * @param signal Carrier cancellation; controller disposal also ends the stream.
   * @returns complete snapshots without an unbounded update backlog.
   */
  @Remote({ mode: 'stream' })
  async *follow(signal: AbortSignal): AsyncIterable<ListTargetsValue> {
    const lifetime = AbortSignal.any([signal, this.lifetime.signal])
    lifetime.throwIfAborted()
    let changed = true
    let wake: (() => void) | undefined
    const off = this.ctx.on('execution-host-targets/changed', () => { changed = true; wake?.() })
    try {
      while (!lifetime.aborted) {
        if (changed) {
          changed = false
          yield await this.invoke(lifetime, () => this.ctx.executionHostTargets.list())
          continue
        }
        await new Promise<void>((resolve) => {
          const done = (): void => { lifetime.removeEventListener('abort', done); wake = undefined; resolve() }
          wake = done
          lifetime.addEventListener('abort', done, { once: true })
          if (lifetime.aborted || changed) done()
        })
      }
    } finally { off() }
  }

  /**
   * Persist an OpenSSH alias without connecting.
   * @param request Label and alias; never credentials or flags.
   * @param signal Carrier cancellation before admission.
   * @returns the durable disconnected target.
   */
  @Remote
  create(request: CreateTargetRequest, signal: AbortSignal): Promise<TargetValue> {
    return this.invoke(signal, () => this.ctx.executionHostTargets.create(request))
  }

  /**
   * Replace saved metadata at its exact revision after disconnecting.
   * @param request Current revision and replacement fields.
   * @param signal Carrier cancellation before admission.
   * @returns the committed target.
   */
  @Remote
  update(request: UpdateTargetRequest, signal: AbortSignal): Promise<TargetValue> {
    return this.invoke(signal, () => this.ctx.executionHostTargets.update(request))
  }

  /**
   * Remove a target after owned remote work settles.
   * @param request Exact saved revision.
   * @param signal Carrier cancellation before admission.
   * @returns durable deletion acknowledgement.
   */
  @Remote
  removeTarget(request: TargetRevisionRequest, signal: AbortSignal): Promise<Record<string, never>> {
    return this.invoke(signal, () => this.ctx.executionHostTargets.remove(request))
  }

  /**
   * Authenticate and inspect an exported root before publishing readiness.
   * @param request Target and exact saved revision.
   * @param signal Carrier cancellation propagated through worker settlement.
   * @returns the ready worker identity and connection generation.
   */
  @Remote
  connect(request: TargetRevisionRequest, signal: AbortSignal): Promise<TargetValue> {
    return this.invoke(signal, () => this.ctx.executionHostTargets.connect(request, signal))
  }

  /**
   * Close a target after cancellation acknowledgement for admitted work.
   * @param request Saved target identity.
   * @param signal Carrier cancellation before admission.
   * @returns the disconnected target.
   */
  @Remote
  disconnect(request: TargetRequest, signal: AbortSignal): Promise<TargetValue> {
    return this.invoke(signal, () => this.ctx.executionHostTargets.disconnect(request))
  }

  /**
   * Read a bounded directory listing inside an exported root.
   * @param request Target, generation, root and relative path.
   * @param signal Carrier cancellation propagated through worker settlement.
   * @returns the directory result with target provenance.
   */
  @Remote
  inspectDirectory(request: InspectDirectoryRequest, signal: AbortSignal): Promise<InspectionValue> {
    return this.invoke(signal, () => this.ctx.executionHostTargets.inspectDirectory(request, signal))
  }

  /**
   * Inspect an explicit endpoint without installing or changing target selection.
   * @param request - Pinned endpoint and existing remote installation location.
   * @param signal - Cancellation of this read-only inspection.
   * @returns verified runtime observations.
   */
  @Remote
  detectRuntime(request: RuntimeLocation, signal: AbortSignal): Promise<RuntimeInspection> {
    return this.invoke(signal, () => this.localRuntime().detect(request, signal))
  }

  /**
   * Start a Host-owned install or update; carrier disconnect does not cancel the accepted task.
   * @param request - Exact target revision and explicit remote location.
   * @param signal - Admission cancellation only.
   * @returns the task receipt immediately after admission.
   */
  @Remote
  startRuntime(request: RuntimeStartRequest, signal: AbortSignal): Promise<RuntimeTaskValue> {
    return this.invoke(signal, () => this.localRuntime().start(request))
  }

  /**
   * Read one installation receipt without changing its lifetime.
   * @param request - Exact task identity.
   * @param signal - Read admission cancellation.
   * @returns the current task observation.
   */
  @Remote
  getRuntimeTask(request: RuntimeTaskRequest, signal: AbortSignal): Promise<RuntimeTaskValue> {
    return this.invoke(signal, () => this.localRuntime().get(request))
  }

  /**
   * Observe a task; ending this stream detaches only the observer.
   * @param request - Exact task identity.
   * @param signal - Observer lifetime; controller disposal ends observation normally without cancelling the task.
   * @returns serializable complete task observations.
   */
  @Remote({ mode: 'stream' })
  followRuntimeTask(request: RuntimeTaskRequest, signal: AbortSignal): AsyncIterable<RuntimeTaskValue> {
    signal.throwIfAborted()
    const lifetime = AbortSignal.any([signal, this.lifetime.signal])
    const stream = this.localRuntime().follow(request, lifetime)
    return this.runtimeStream(stream, lifetime)
  }

  /**
   * Explicitly cancel one task and wait for its owned process cleanup.
   * @param request - Exact receipt chosen by the operator.
   * @param signal - Cancellation admission only.
   * @returns the settled task observation.
   */
  @Remote
  cancelRuntimeTask(request: RuntimeTaskRequest, signal: AbortSignal): Promise<RuntimeTaskValue> {
    return this.invoke(signal, () => this.localRuntime().cancel(request))
  }

  /**
   * Recover task receipts after a renderer reload without creating new tasks.
   * @param signal - Observation admission cancellation.
   * @returns bounded redacted task observations retained by this Host.
   */
  @Remote
  listRuntimeTasks(signal: AbortSignal): Promise<RuntimeTasksValue> {
    return this.invoke(signal, () => this.localRuntime().listTasks())
  }

  private localRuntime() {
    const access = this.ctx.get('typertGateway')?.currentAccess()
    if (access?.kind !== 'trusted-local' || access.signal.aborted) {
      throw new RemoteError('execution-host/local-access-required', 'Runtime management requires authenticated local access', {})
    }
    const runtime = this.ctx.get('executionRuntimes')
    if (runtime === undefined) throw new RemoteError('execution-host/runtime-unavailable', 'Execution runtime installer is unavailable', {})
    return runtime
  }

  private async *runtimeStream(stream: AsyncIterable<RuntimeTaskValue>, signal: AbortSignal): AsyncIterable<RuntimeTaskValue> {
    const iterator = stream[Symbol.asyncIterator]()
    try {
      try {
        while (true) {
          const item = await iterator.next()
          if (item.done) return
          yield item.value
        }
      } finally { await iterator.return?.() }
    } catch (error) {
      if (signal.aborted && error === signal.reason) return
      this.fail(error)
    }
  }

  private async invoke<T>(signal: AbortSignal, operation: () => T | Promise<T>): Promise<T> {
    signal.throwIfAborted()
    try { return await operation() }
    catch (error) { this.fail(error) }
  }

  private fail(error: unknown): never {
    if (remoteErrorOf(error) !== undefined) throw error
    if (error instanceof RuntimeError) {
      throw new RemoteError(`execution-runtime/${error.code}`, error.message, {}, { cause: error })
    }
    if (error instanceof ExecutionTargetError) {
      const code = `execution-host/${error.code}` as const
      throw new RemoteError(code, error.message, {}, { cause: error })
    }
    throw new RemoteError('execution-host/inspection-failed', 'Execution host operation failed', {}, { cause: error })
  }
}
