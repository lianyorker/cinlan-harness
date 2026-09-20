/** Durable execution selection and leased official SSH provider worlds. */
import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, posix } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent, AgentSetupCommit } from '@deepseek-ai/dsh-agent'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SandboxExecutionPolicy, SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-execution-host-targets'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SshConnection from '@deepseek-ai/dsh-ssh'
import SshFileSystem from '@deepseek-ai/dsh-fs-ssh'
import SshSubprocessRuntime from '@deepseek-ai/dsh-subprocess-ssh'
import SshSandboxProvider from '@deepseek-ai/dsh-sandbox-ssh'
import { SandboxPolicyService, type SandboxPolicyRequest } from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session-projection'
import { NodePtcRuntime } from '@deepseek-ai/dsh-ptc-runtime-node'
import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox'
import { LocalGitRuntime } from '@deepseek-ai/dsh-git-local'
import { TerminalSessionService } from '@deepseek-ai/dsh-terminal'
import * as TerminalBash from '@deepseek-ai/dsh-terminal-bash'
import { Config } from './config.ts'
import { executionBindingProjection, executionBindingSchema, foldExecutionBinding } from './session.ts'
import type { ExecutionBinding, ExecutionIncarnation, ExecutionLease, SshExecutionSnapshot } from './types.ts'
export type * from './types.ts'
export { executionBindingSchema, foldExecutionBinding } from './session.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { executionBindings: ExecutionBindings }
}

const services = ['ssh', 'fs', 'subprocess', 'sandbox', 'sandboxPolicy', 'ptcRuntime', 'shell', 'git', 'terminals'] as const
interface World {
  readonly ctx: Context
  readonly scope: Scope
  readonly binding: SshExecutionSnapshot
  readonly root: string
  readonly platform: 'linux' | 'darwin'
  readonly incarnation: ExecutionIncarnation
  readonly signal: AbortSignal
}
interface PendingWorld { readonly ready: Promise<World>; holders: number }
interface AgentExecution { readonly agent: Agent; readonly lease: ExecutionLease; readonly ctx: Context }
interface AdmissionState { generation: number; observers: number }
interface AdmissionObservation {
  readonly state: AdmissionState
  readonly generation: number
  readonly admission: Agent | undefined
  readonly execution: AgentExecution | undefined
}
const local: ExecutionBinding = Object.freeze({ kind: 'local' })

/** One controller Host retains Session authority while project effects use captured providers. */
export default class ExecutionBindings extends Service {
  static inject = ['sessionQuery', 'sessionProjections']
  static Config = Config
  private readonly owner: { readonly ctx: Context }
  private readonly worlds = new Map<string, PendingWorld>()
  private readonly agents = new Map<SessionId, AgentExecution>()
  private readonly prepared = new WeakMap<Agent, AgentExecution>()
  private readonly admissions = new Map<SessionId, Agent>()
  private readonly admissionStates = new Map<SessionId, AdmissionState>()
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'executionBindings')
    this.owner = { ctx }
    ctx.sessionProjections.register(executionBindingProjection)
    ctx.effect(() => async () => {
      this.lifetime.abort(new Error('Execution binding service disposed'))
      await Promise.allSettled([...this.pending])
      const results = await Promise.allSettled([...this.worlds.values()].map(async holder => (await holder.ready).scope.dispose()))
      this.worlds.clear()
      this.agents.clear()
      this.admissions.clear()
      this.admissionStates.clear()
      const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
      if (failures.length > 0) throw new AggregateError(failures, 'Remote execution teardown failed')
    })
  }

  /**
   * Read a live or durable Session selection without activating an Agent.
   * Admission changes invalidate an observation captured across an await; a published Agent is authoritative.
   * @param sessionId - known Session identity.
   * @param signal - observation cancellation.
   * @returns immutable location; legacy known Sessions are local only while no admission supersedes that observation.
   */
  async bindingForSession(sessionId: SessionId, signal?: AbortSignal): Promise<ExecutionBinding> {
    for (;;) {
      this.lifetime.signal.throwIfAborted()
      const admission = this.observeAdmission(sessionId)
      try {
        const active = this.publishedExecution(sessionId)
        if (active !== undefined) {
          active.lease.assertCurrent()
          return active.lease.binding
        }
        using observation = await this.ctx.sessionQuery.observeSession(sessionId, {
          projectionMode: 'none', ...(signal === undefined ? {} : { signal }),
        })
        if (!this.admissionCurrent(sessionId, admission)) continue
        const published = this.publishedExecution(sessionId)
        if (published !== undefined) return published.lease.binding
        return foldExecutionBinding(observation.events) ?? local
      } finally {
        this.releaseAdmissionObservation(sessionId, admission.state)
      }
    }
  }

  /**
   * Retain the same execution incarnation as the live Agent, or acquire its durable binding.
   * Admission changes invalidate every awaited cold result before it can fall back to local execution.
   * @param sessionId - owning Session identity.
   * @param signal - caller cancellation before lease delivery.
   * @returns caller-owned lease; never creates or drives an Agent.
   */
  async forSession(sessionId: SessionId, signal?: AbortSignal): Promise<ExecutionLease> {
    for (;;) {
      this.lifetime.signal.throwIfAborted()
      const admission = this.observeAdmission(sessionId)
      try {
        const active = this.publishedExecution(sessionId)
        if (active !== undefined) {
          active.lease.assertCurrent()
          const retained = await this.retain(active.lease, signal)
          if (!this.admissionCurrent(sessionId, admission) || this.publishedExecution(sessionId) !== active) {
            await retained.release()
            continue
          }
          active.lease.assertCurrent()
          const lifetime = AbortSignal.any([retained.signal, active.lease.signal])
          return { ...retained, ctx: active.ctx, signal: lifetime, assertCurrent: () => { lifetime.throwIfAborted() } }
        }
        using observation = await this.ctx.sessionQuery.observeSession(sessionId, {
          projectionMode: 'none', ...(signal === undefined ? {} : { signal }),
        })
        if (!this.admissionCurrent(sessionId, admission)) continue
        if (this.publishedExecution(sessionId) !== undefined) continue
        const cwd = observation.header.cwd
        if (cwd === undefined) throw new Error('Session has no execution working directory')
        const lease = await this.acquire(foldExecutionBinding(observation.events) ?? local, cwd, signal)
        if (!this.admissionCurrent(sessionId, admission)) {
          await lease.release()
          continue
        }
        if (lease.binding.kind === 'local') return lease
        const mode = observation.events.reduce<SandboxMode>((current, event) =>
          event.type === 'sandbox/mode' ? event.data.mode : current, this.config.sandboxMode)
        const cold = await this.coldSessionLease(lease, { mode, workspaceRoot: lease.cwd, sessionId }, signal)
        if (!this.admissionCurrent(sessionId, admission)) {
          await cold.release()
          continue
        }
        return cold
      } finally {
        this.releaseAdmissionObservation(sessionId, admission.state)
      }
    }
  }

  private publishedExecution(sessionId: SessionId): AgentExecution | undefined {
    const admission = this.admissions.get(sessionId)
    if (admission === undefined) return undefined
    if (this.owner.ctx.get('agents')?.get(sessionId) !== admission) {
      throw new Error('Session execution admission is not published')
    }
    const execution = this.agents.get(sessionId)
    if (execution === undefined || execution.agent !== admission) {
      throw new Error('Published Session execution admission has no provider lease')
    }
    execution.lease.assertCurrent()
    return execution
  }

  private observeAdmission(sessionId: SessionId): AdmissionObservation {
    let state = this.admissionStates.get(sessionId)
    if (state === undefined) {
      state = { generation: 0, observers: 0 }
      this.admissionStates.set(sessionId, state)
    }
    state.observers++
    return { state, generation: state.generation, admission: this.admissions.get(sessionId), execution: this.agents.get(sessionId) }
  }

  private admissionCurrent(sessionId: SessionId, observation: AdmissionObservation): boolean {
    return this.admissionStates.get(sessionId) === observation.state
      && observation.state.generation === observation.generation
      && this.admissions.get(sessionId) === observation.admission
      && this.agents.get(sessionId) === observation.execution
  }

  private admissionChanged(sessionId: SessionId): void {
    let state = this.admissionStates.get(sessionId)
    if (state === undefined) {
      state = { generation: 0, observers: 0 }
      this.admissionStates.set(sessionId, state)
    }
    state.generation++
    this.deleteUnusedAdmissionState(sessionId, state)
  }

  private releaseAdmissionObservation(sessionId: SessionId, state: AdmissionState): void {
    state.observers--
    this.deleteUnusedAdmissionState(sessionId, state)
  }

  private deleteUnusedAdmissionState(sessionId: SessionId, state: AdmissionState): void {
    if (state.observers === 0 && this.admissions.get(sessionId) === undefined && this.agents.get(sessionId) === undefined
      && this.admissionStates.get(sessionId) === state) this.admissionStates.delete(sessionId)
  }

  /**
   * Capture paired providers and canonicalize a directory in that execution world.
   * @param binding - selected immutable deployment.
   * @param cwd - absolute directory in that deployment.
   * @param signal - caller cancellation before lease delivery.
   * @returns caller-owned lease retained through any spawned work.
   */
  acquire(binding: ExecutionBinding, cwd: string, signal?: AbortSignal): Promise<ExecutionLease> {
    return this.track(this.acquireOnce(binding, cwd, signal))
  }

  private async acquireOnce(binding: ExecutionBinding, cwd: string, signal?: AbortSignal): Promise<ExecutionLease> {
    this.lifetime.signal.throwIfAborted()
    signal?.throwIfAborted()
    const parsed = executionBindingSchema.parse(binding)
    const selected = parsed.kind === 'local' ? local : Object.freeze({ ...parsed, endpoint: Object.freeze({ ...parsed.endpoint }) })
    if (selected.kind === 'local') {
      if (!isAbsolute(cwd)) throw new Error('Local execution directory must be absolute')
      const canonical = await realpath(cwd)
      if (!(await stat(canonical)).isDirectory()) throw new Error('Execution directory is not a directory')
      signal?.throwIfAborted()
      return this.localLease(canonical)
    }
    const targets = this.targets()
    targets.resolveExecution(selected)
    if (!posix.isAbsolute(cwd)) throw new Error('SSH execution directory must be an absolute POSIX path')
    const key = JSON.stringify(selected)
    let holder = this.worlds.get(key)
    if (holder === undefined) {
      holder = { ready: this.openWorld(selected), holders: 0 }
      this.worlds.set(key, holder)
      void holder.ready.catch(() => { if (this.worlds.get(key) === holder) this.worlds.delete(key) })
    }
    holder.holders++
    try {
      const world = await holder.ready
      const admission = AbortSignal.any([this.lifetime.signal, world.signal, ...(signal === undefined ? [] : [signal])])
      admission.throwIfAborted()
      targets.resolveExecution(selected)
      const fs = world.ctx.get('fs')
      if (fs === undefined) throw new Error('Remote filesystem provider is unavailable')
      const target = await fs.resolve(cwd, { signal: admission })
      const root = await fs.resolve(world.root, { signal: admission })
      if (!fs.contains(root, target)) throw new Error('Execution directory is outside its captured remote root')
      if ((await fs.stat(target, admission))?.type !== 'directory') throw new Error('Remote execution directory is not a directory')
      admission.throwIfAborted()
      return this.worldLease(holder, world, fs.processPath(target))
    } catch (error) {
      await this.releaseWorld(key, holder)
      throw error
    }
  }

  private localLease(cwd: string): ExecutionLease {
    let released = false
    const lifetime = new AbortController()
    const signal = AbortSignal.any([lifetime.signal, this.lifetime.signal])
    return { binding: local, ctx: this.owner.ctx, cwd, platform: process.platform,
      incarnation: 'local' as ExecutionIncarnation, signal,
      assertCurrent: () => { signal.throwIfAborted() },
      release: () => {
        if (!released) { released = true; lifetime.abort(new Error('Execution lease released')) }
        return Promise.resolve()
      },
    }
  }

  private worldLease(holder: PendingWorld, world: World, cwd: string): ExecutionLease {
    let releasing: Promise<void> | undefined
    const lifetime = new AbortController()
    const signal = AbortSignal.any([lifetime.signal, this.lifetime.signal, world.signal])
    return { binding: world.binding, ctx: world.ctx, cwd, platform: world.platform, incarnation: world.incarnation, signal,
      assertCurrent: () => { signal.throwIfAborted() },
      release: () => {
        lifetime.abort(new Error('Execution lease released'))
        return releasing ??= this.releaseWorld(JSON.stringify(world.binding), holder)
      },
    }
  }

  private async retain(lease: ExecutionLease, signal?: AbortSignal): Promise<ExecutionLease> {
    signal?.throwIfAborted()
    lease.assertCurrent()
    if (lease.binding.kind === 'local') return this.localLease(lease.cwd)
    const holder = this.worlds.get(JSON.stringify(lease.binding))
    if (holder === undefined) throw new Error('Session execution incarnation is no longer available')
    const world = await holder.ready
    signal?.throwIfAborted()
    lease.assertCurrent()
    if (world.incarnation !== lease.incarnation) throw new Error('Session execution incarnation changed')
    holder.holders++
    return this.worldLease(holder, world, lease.cwd)
  }

  private async releaseWorld(key: string, holder: PendingWorld): Promise<void> {
    holder.holders--
    if (holder.holders !== 0) return
    if (this.worlds.get(key) === holder) this.worlds.delete(key)
    const world = await holder.ready.catch(() => undefined)
    await world?.scope.dispose()
  }

  /**
   * Bind an unpublished Agent before its consumers mount and reserve target authorization through publication.
   * @param agentCtx - creation-owned scoped context.
   * @param agent - unpublished Agent and its durable Session.
   * @param binding - explicit selection for a new Session; omitted reuses its log.
   * @returns synchronous publication commit; scope rollback releases the authorization and provider lease.
   */
  async setup(agentCtx: Context, agent: Agent, binding?: ExecutionBinding): Promise<AgentSetupCommit> {
    if (this.prepared.has(agent)) throw new Error('Agent execution is already prepared')
    const prior = foldExecutionBinding(agent.session.snapshotEvents())
    const selected = binding === undefined ? prior ?? local : executionBindingSchema.parse(binding)
    if (prior !== null && JSON.stringify(prior) !== JSON.stringify(selected)) throw new Error('Session execution binding cannot change')
    if (prior === null && selected.kind === 'ssh' && agent.session.snapshotEvents().some(event => event.type === 'user/message' || event.type === 'request/header')) {
      throw new Error('An existing local Session cannot be moved to SSH')
    }
    const cwd = agent.session.header.cwd
    if (cwd === undefined) throw new Error('Session execution binding requires a working directory')
    if (this.admissions.has(agent.id)) throw new Error('Session execution admission already exists')
    const authorization = selected.kind === 'ssh' ? this.targets().reserveExecution(selected) : undefined
    const cancellation = new AbortController()
    // oxlint-disable-next-line prefer-const -- register teardown before starting the acquisition it joins.
    let acquiring: Promise<ExecutionLease> | undefined
    try {
      agentCtx.effect(() => async () => {
        cancellation.abort(new Error('Agent execution scope disposed'))
        const acquired = acquiring === undefined
          ? undefined : await acquiring.catch(() => undefined) // Admission reports its own failure; teardown joins it.
        if (this.agents.get(agent.id)?.lease === acquired) {
          this.agents.delete(agent.id)
          this.admissionChanged(agent.id)
        }
        this.prepared.delete(agent)
        try { await acquired?.release() } finally {
          authorization?.release()
          if (this.admissions.get(agent.id) === agent) {
            this.admissions.delete(agent.id)
            this.admissionChanged(agent.id)
          }
        }
      })
    } catch (error) {
      authorization?.release()
      throw error
    }
    this.admissions.set(agent.id, agent)
    this.admissionChanged(agent.id)
    acquiring = this.acquire(selected, cwd, cancellation.signal)
    const lease = await acquiring
    if (cancellation.signal.aborted) {
      await lease.release()
      cancellation.signal.throwIfAborted()
    }
    if (selected.kind === 'ssh') {
      const isolate = Object.create(agentCtx[Context.isolate]) as Record<string, symbol>
      for (const name of services) {
        const realm = lease.ctx[Context.isolate][name]
        if (realm === undefined) throw new Error('Remote execution provider realm is missing: ' + name)
        isolate[name] = realm
      }
      let consumerCtx = agentCtx.extend({ [Context.isolate]: isolate })
      for (const name of ['fs', 'sandboxPolicy', 'shell', 'ptcRuntime', 'git', 'terminals']) consumerCtx = consumerCtx.isolate(name)
      agentCtx[Context.isolate] = consumerCtx[Context.isolate]
      const ssh = agentCtx.get('ssh')
      if (ssh === undefined) throw new Error('SSH connection provider is unavailable')
      await this.mountCapabilities(agentCtx, lease.cwd, ssh, agent.session)
      cancellation.signal.throwIfAborted()
    }
    const execution = { agent, lease, ctx: agentCtx }
    this.prepared.set(agent, execution)
    if (prior === null) agent.session.append('execution/bound', { binding: selected })
    return { commit: () => {
      cancellation.signal.throwIfAborted()
      lease.assertCurrent()
      authorization?.assertCurrent()
      if (this.prepared.get(agent) !== execution) throw new Error('Agent execution binding was superseded')
      this.agents.set(agent.id, execution)
      this.admissionChanged(agent.id)
      authorization?.release()
    } }
  }

  /**
   * Address the providers installed during this exact Agent admission.
   * @param agent - prepared or published Agent.
   * @returns provider context, execution platform and immutable selection.
   */
  executionForAgent(agent: Agent): Pick<ExecutionLease, 'ctx' | 'platform' | 'binding'> {
    const execution = this.prepared.get(agent)
    if (execution === undefined || execution.agent !== agent) throw new Error('Agent execution is not bound')
    execution.lease.assertCurrent()
    return { ctx: execution.ctx, platform: execution.lease.platform, binding: execution.lease.binding }
  }

  private targets() {
    const targets = this.ctx.get('executionHostTargets')
    if (targets === undefined) throw new Error('SSH execution binding requires the execution host targets service')
    return targets
  }

  private async openWorld(binding: SshExecutionSnapshot): Promise<World> {
    const scope = createScope(this.owner.ctx, {})
    let ctx = scope.ctx
    for (const name of services) ctx = ctx.isolate(name)
    try {
      const config = this.targets().resolveExecution(binding)
      await ctx.plugin(SshConnection, { ...config, requestTimeoutMs: this.config.connectionTimeoutMs })
      const ssh = ctx.get('ssh')
      if (ssh === undefined) throw new Error('SSH connection provider is unavailable')
      const hello = await ssh.ready
      await ctx.plugin(SshSubprocessRuntime)
      await ctx.plugin(SshSandboxProvider)
      await this.mountCapabilities(ctx, hello.workspace, ssh)
      this.lifetime.signal.throwIfAborted()
      ssh.signal.throwIfAborted()
      return { ctx, scope, binding, root: hello.workspace, platform: hello.platform,
        incarnation: randomUUID() as ExecutionIncarnation, signal: ssh.signal }
    } catch (error) {
      try { await scope.dispose() } catch (cleanup) { throw new AggregateError([error, cleanup], 'Remote execution setup and cleanup failed') }
      throw error
    }
  }

  private async coldSessionLease(lease: ExecutionLease, policy: SandboxExecutionPolicy, signal?: AbortSignal): Promise<ExecutionLease> {
    const scope = createScope(lease.ctx, {})
    let ctx = scope.ctx
    for (const name of ['fs', 'sandboxPolicy', 'shell', 'ptcRuntime', 'git', 'terminals']) ctx = ctx.isolate(name)
    const lifetime = new AbortController()
    scope.ctx.effect(() => () => { lifetime.abort(new Error('Session execution observation released')) })
    let releasing: Promise<void> | undefined
    const release = (): Promise<void> => releasing ??= (async () => {
      const errors: unknown[] = []
      try { await scope.dispose() } catch (error) { errors.push(error) }
      try { await lease.release() } catch (error) { errors.push(error) }
      if (errors.length > 0) throw new AggregateError(errors, 'Session execution observation cleanup failed')
    })()
    try {
      const ssh = ctx.get('ssh')
      if (ssh === undefined) throw new Error('SSH connection provider is unavailable')
      await this.mountCapabilities(ctx, lease.cwd, ssh, undefined, policy)
      signal?.throwIfAborted()
      lease.assertCurrent()
      const captured = AbortSignal.any([lease.signal, lifetime.signal])
      return { ...lease, ctx, signal: captured, assertCurrent: () => { captured.throwIfAborted() }, release }
    } catch (error) {
      try { await release() } catch (cleanup) { throw new AggregateError([error, cleanup], 'Session observation setup and cleanup failed') }
      throw error
    }
  }

  private async mountCapabilities(
    ctx: Context, cwd: string, ssh: SshConnection, session?: Session, policy?: SandboxExecutionPolicy,
  ): Promise<void> {
    class BoundPolicy extends SandboxPolicyService {
      override resolve(request: SandboxPolicyRequest = {}) {
        const resolved = super.resolve({ ...request, ...(request.session === undefined && session !== undefined ? { session } : {}) })
        return policy !== undefined && request.session === undefined
          ? { ...resolved, ...policy, mode: request.mode ?? policy.mode } : resolved
      }
    }
    const policyProvider = session === undefined && policy === undefined ? SandboxPolicyService : BoundPolicy
    await ctx.plugin(policyProvider, { mode: this.config.sandboxMode, workspaceRoot: cwd })
    await ctx.plugin(SshFileSystem)
    await ctx.plugin(NodePtcRuntime, { nodeExecutable: ssh.nodeExecutable, bootstrapPath: ssh.bootstrapPath })
    await ctx.isolate('settings').plugin(SandboxBashExecutor, {
      cwd, timeoutMs: this.config.shellTimeoutMs, maxTimeoutMs: this.config.shellMaxTimeoutMs,
      maxOutputBytes: this.config.maxOutputBytes, maxSpillBytes: this.config.maxSpillBytes, graceMs: this.config.graceMs,
    })
    await ctx.plugin(LocalGitRuntime, { executable: this.config.gitExecutable, maxOutputBytes: this.config.maxOutputBytes,
      maxLogEntries: this.config.gitMaxLogEntries, graceMs: this.config.graceMs })
    await ctx.plugin(TerminalSessionService)
    await ctx.plugin(TerminalBash, { shellDialect: 'bash', shellPath: this.config.shellPath })
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise)
    void promise.then(() => { this.pending.delete(promise) }, () => { this.pending.delete(promise) })
    return promise
  }
}
