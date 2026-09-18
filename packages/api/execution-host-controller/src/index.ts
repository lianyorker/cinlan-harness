/** Authenticated management of saved SSH targets over the shared Remote carrier. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { ExecutionTargetError } from '@deepseek-ai/dsh-execution-host-targets'
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

  private async invoke<T>(signal: AbortSignal, operation: () => T | Promise<T>): Promise<T> {
    signal.throwIfAborted()
    try { return await operation() }
    catch (error) {
      if (error instanceof ExecutionTargetError) {
        const code = `execution-host/${error.code}` as const
        throw new RemoteError(code, error.message, {}, { cause: error })
      }
      throw new RemoteError('execution-host/inspection-failed', 'Execution host operation failed', {}, { cause: error })
    }
  }
}
