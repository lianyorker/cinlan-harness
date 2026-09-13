/** Process-local implementation of the task-coordination capability. */
import { randomUUID } from 'node:crypto'
import { serialize } from 'node:v8'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  CoordinationError, CoordinationService, RunId, TaskId,
} from '@deepseek-ai/dsh-coordination'
import type {
  CoordinationApprovalDecision, CoordinationApprovalRequest, CoordinationApprovalRequestListener,
  CoordinationEvent, CoordinationEventListener, CoordinationRun, RunSnapshot, StartRunRequest,
  TaskExecutor, TaskMessage, TaskMessageListener, TaskOutcome, TaskSnapshot, TaskSpec, TaskStatus,
} from '@deepseek-ai/dsh-coordination'

/** Local scheduler configuration. */
export interface Config {
  /** Maximum number of executor calls active in one process. */
  maxConcurrency?: number
  /** Maximum number of non-terminal runs retained at once. */
  maxActiveRuns?: number
  /** Maximum number of tasks installed in one run. */
  maxTasksPerRun?: number
  /** Maximum number of terminal runs retained for later reads. */
  maxRetainedRuns?: number
  /** Maximum serialized bytes retained across task declarations and outcomes. */
  maxRetainedBytes?: number
}

interface NormalizedTaskSpec extends TaskSpec {
  readonly id: TaskId
  readonly dependencies: readonly TaskId[]
}

interface MutableTask {
  readonly id: TaskId
  readonly runId: RunId
  readonly label: string
  readonly dependencies: TaskId[]
  readonly executor: string
  readonly input: unknown
  readonly parentId: TaskId | undefined
  status: TaskStatus
  output: unknown
  error: string | undefined
  createdAt: number
  startedAt: number | undefined
  finishedAt: number | undefined
  controller: AbortController | undefined
  cancelRequested: boolean
  cancelReason: string
  retainedBytes: number
}

interface MutableRun {
  readonly id: RunId
  readonly taskIds: TaskId[]
  readonly createdAt: number
  status: RunSnapshot['status']
  finishedAt: number | undefined
  readonly resolve: (snapshot: RunSnapshot) => void
  readonly result: Promise<RunSnapshot>
  cancelRequested: boolean
}

interface PendingApproval {
  readonly request: CoordinationApprovalRequest
  readonly resolve: (decision: CoordinationApprovalDecision) => void
  readonly reject: (error: unknown) => void
}

type TerminalTaskStatus = 'succeeded' | 'failed' | 'cancelled'
type SettledTaskOutcome = { status: TerminalTaskStatus; output?: unknown; error?: string }

function isTerminalTask(status: TaskStatus): status is TerminalTaskStatus {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

function isTerminalRun(status: RunSnapshot['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** In-memory DAG scheduler. It owns graph and lifecycle state, not Agent loops. */
export class LocalCoordinationService extends CoordinationService {
  static Config: z<Config> = z.object({
    maxConcurrency: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(4),
    maxActiveRuns: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16),
    maxTasksPerRun: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(128),
    maxRetainedRuns: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(32),
    maxRetainedBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16_777_216),
  })

  private readonly maxConcurrency: number
  private readonly maxActiveRuns: number
  private readonly maxTasksPerRun: number
  private readonly maxRetainedRuns: number
  private readonly maxRetainedBytes: number
  private readonly runs = new Map<RunId, MutableRun>()
  private readonly tasks = new Map<TaskId, MutableTask>()
  private readonly terminalRuns: RunId[] = []
  private readonly executors = new Map<string, TaskExecutor>()
  private readonly events = new Set<CoordinationEventListener>()
  private readonly messages = new Set<TaskMessageListener>()
  private readonly approvals = new Set<CoordinationApprovalRequestListener>()
  private readonly pendingApprovals = new Map<string, PendingApproval>()
  private readonly executions = new Set<Promise<void>>()
  private active = 0
  private retainedBytes = 0
  private pumpQueued = false
  private disposed = false

  constructor(ctx: Context, config: Config) {
    super(ctx)
    const resolved = config as Required<Config>
    this.maxConcurrency = resolved.maxConcurrency
    this.maxActiveRuns = resolved.maxActiveRuns
    this.maxTasksPerRun = resolved.maxTasksPerRun
    this.maxRetainedRuns = resolved.maxRetainedRuns
    this.maxRetainedBytes = resolved.maxRetainedBytes
    ctx.effect(() => async () => {
      this.disposed = true
      this.events.clear()
      this.messages.clear()
      this.approvals.clear()

      const disposalError = new CoordinationError('coordination service disposed', 'INVALID_TRANSITION')
      for (const pending of this.pendingApprovals.values()) pending.reject(disposalError)
      this.pendingApprovals.clear()
      for (const run of this.runs.values()) run.cancelRequested = true
      for (const task of this.tasks.values()) this.cancelTask(task, 'coordination service disposed')
      for (const run of this.runs.values()) this.updateRun(run)

      while (this.executions.size > 0) await Promise.allSettled([...this.executions])
      this.executors.clear()
      this.tasks.clear()
      this.runs.clear()
      this.terminalRuns.length = 0
      this.retainedBytes = 0
    }, 'coordination.dispose')
  }

  registerExecutor(kind: string, executor: TaskExecutor): () => void {
    this.assertActive()
    const normalizedKind = kind.trim()
    if (normalizedKind.length === 0) throw new CoordinationError('executor kind must be non-empty', 'INVALID_TASK')
    if (this.executors.has(normalizedKind)) throw new CoordinationError(`executor "${normalizedKind}" is already registered`, 'INVALID_TASK')
    const dispose = this.ctx.effect(() => {
      this.executors.set(normalizedKind, executor)
      return () => {
        this.executors.delete(normalizedKind)
        // A single executor contribution can unload while the service stays
        // alive (its backing provider was removed, an HMR reload swapped it).
        // Full-service disposal is the constructor effect's job — it aborts and
        // awaits every in-flight execution to a `cancelled` outcome — so leave
        // that path to it. Here the service is still running, and a task left
        // `running` under this kind would hang forever on an executor that no
        // longer exists (its promise may never settle now). Fail those tasks
        // now with the same diagnostic pre-dispatch admission uses.
        if (this.disposed) return
        this.failOrphanedTasks(normalizedKind)
      }
    }, 'coordination.executor')
    return () => { void dispose() }
  }

  start(request: StartRunRequest): CoordinationRun {
    this.assertActive()
    if (request.tasks.length === 0) {
      throw new CoordinationError('a run requires at least one task', 'INVALID_RUN')
    }
    if (this.activeRunCount() >= this.maxActiveRuns) {
      throw new CoordinationError(`coordination reached its active-run cap (${this.maxActiveRuns})`, 'RESOURCE_LIMIT')
    }
    if (request.tasks.length > this.maxTasksPerRun) {
      throw new CoordinationError(`run declares ${request.tasks.length} tasks, over the per-run cap (${this.maxTasksPerRun})`, 'RESOURCE_LIMIT')
    }
    const runId = RunId(`run-${randomUUID()}`)
    const specs = request.tasks.map(spec => this.normalizeSpec(spec))
    this.validateGraph(specs)
    this.validateTaskIdsAvailable(specs)
    this.validateExecutors(specs)
    const specBytes = specs.map(spec => retainedByteLength(spec, 'task declaration'))
    this.ensureCapacity(specBytes.reduce((total, bytes) => total + bytes, 0), 'run task declarations')
    let resolveRun!: (snapshot: RunSnapshot) => void
    const result = new Promise<RunSnapshot>((resolve) => { resolveRun = resolve })
    const run: MutableRun = {
      id: runId,
      taskIds: [],
      createdAt: Date.now(),
      status: 'running',
      finishedAt: undefined,
      resolve: resolveRun,
      result,
      cancelRequested: false,
    }
    this.runs.set(runId, run)
    for (const [index, spec] of specs.entries()) this.installTask(run, spec, specBytes[index] as number, false)
    this.emit({ type: 'run/started', run: this.snapshotRun(run) })
    for (const id of run.taskIds) this.emit({ type: 'task/changed', task: this.snapshotTask(this.tasks.get(id) as MutableTask) })
    this.queuePump()
    return this.handle(run)
  }

  getRun(id: RunId): RunSnapshot {
    return this.snapshotRun(this.runs.get(id) ?? this.throwError('unknown run', 'UNKNOWN_RUN'))
  }

  getTask(id: TaskId): TaskSnapshot {
    return this.snapshotTask(this.tasks.get(id) ?? this.throwError('unknown task', 'UNKNOWN_TASK'))
  }

  listTasks(runId: RunId): TaskSnapshot[] {
    const run = this.runs.get(runId)
    if (run === undefined) throw new CoordinationError(`unknown run ${String(runId)}`, 'UNKNOWN_RUN')
    return run.taskIds.map(id => this.getTask(id))
  }

  addTask(runId: RunId, spec: TaskSpec): TaskId {
    this.assertActive()
    const run = this.runs.get(runId)
    if (run === undefined) throw new CoordinationError(`unknown run ${String(runId)}`, 'UNKNOWN_RUN')
    if (isTerminalRun(run.status)) throw new CoordinationError(`run ${String(runId)} is already terminal`, 'INVALID_TRANSITION')
    if (run.taskIds.length >= this.maxTasksPerRun) {
      throw new CoordinationError(`run ${String(runId)} reached its task cap (${this.maxTasksPerRun})`, 'RESOURCE_LIMIT')
    }
    const normalized = this.normalizeSpec(spec)
    this.validateTaskIdsAvailable([normalized])
    const specs = run.taskIds.map(id => this.specOf(this.tasks.get(id) as MutableTask))
    specs.push(normalized)
    this.validateGraph(specs)
    this.validateExecutors([normalized])
    const specBytes = retainedByteLength(normalized, 'task declaration')
    this.ensureCapacity(specBytes, 'task declaration')
    const id = this.installTask(run, normalized, specBytes)
    this.propagateBlockedTasks(run)
    this.updateRun(run)
    this.queuePump()
    return id
  }

  cancel(target: RunId | TaskId, reason = 'cancelled by caller'): void {
    this.assertActive()
    const retainedReason = this.boundDiagnostic(reason, 'cancellation reason')
    const run = this.runs.get(target as RunId)
    if (run !== undefined) {
      if (isTerminalRun(run.status)) return
      run.cancelRequested = true
      for (const id of run.taskIds) this.cancelTask(this.tasks.get(id) as MutableTask, retainedReason)
      this.updateRun(run)
      return
    }
    const task = this.tasks.get(target as TaskId)
    if (task === undefined) throw new CoordinationError(`unknown coordination target ${String(target)}`, 'UNKNOWN_TASK')
    if (isTerminalTask(task.status)) return
    const runTasks = this.listTasks(task.runId).map(snapshot => this.tasks.get(snapshot.id) as MutableTask)
    const subtree = new Set<TaskId>([task.id])
    let changed = true
    while (changed) {
      changed = false
      for (const candidate of runTasks) {
        if (candidate.parentId !== undefined && subtree.has(candidate.parentId) && !subtree.has(candidate.id)) {
          subtree.add(candidate.id)
          changed = true
        }
      }
    }
    for (const id of subtree) this.cancelTask(this.tasks.get(id) as MutableTask, retainedReason)
    const owningRun = this.runs.get(task.runId) as MutableRun
    this.propagateBlockedTasks(owningRun)
    this.updateRun(owningRun)
  }

  sendMessage(taskId: TaskId, message: string, sender?: string): TaskMessage {
    this.assertActive()
    this.getTask(taskId)
    if (message.trim().length === 0) throw new CoordinationError('task message must be non-empty', 'INVALID_TASK')
    const record: TaskMessage = { taskId, message, ...sender === undefined ? {} : { sender }, createdAt: Date.now() }
    this.emit({ type: 'task/message', message: record })
    for (const listener of this.messages) this.notify(listener, detachValue(record, 'task message'))
    return detachValue(record, 'task message')
  }

  onMessage(listener: TaskMessageListener): () => void {
    this.assertActive()
    const dispose = this.ctx.effect(() => {
      this.messages.add(listener)
      return () => this.messages.delete(listener)
    }, 'coordination.message-listener')
    return () => { void dispose() }
  }

  requestApproval(request: CoordinationApprovalRequest): Promise<CoordinationApprovalDecision> {
    this.assertActive()
    const committed = detachValue(request, 'approval request')
    const task = this.tasks.get(committed.taskId)
    if (task === undefined) throw new CoordinationError(`unknown task ${String(committed.taskId)}`, 'UNKNOWN_TASK')
    if (isTerminalTask(task.status)) {
      throw new CoordinationError(`task ${String(committed.taskId)} is already terminal`, 'INVALID_TRANSITION')
    }
    if (committed.gateId.trim().length === 0 || committed.prompt.trim().length === 0) throw new CoordinationError('approval gate id and prompt must be non-empty', 'INVALID_TASK')
    const key = approvalKey(committed)
    if (this.pendingApprovals.has(key)) throw new CoordinationError(`approval gate ${key} is already pending`, 'APPROVAL_PENDING')
    if (this.approvals.size === 0) throw new CoordinationError('no approval adapter is available', 'APPROVAL_UNAVAILABLE')
    const promise = new Promise<CoordinationApprovalDecision>((resolve, reject) => {
      this.pendingApprovals.set(key, { request: committed, resolve, reject })
    })
    this.emit({ type: 'task/approval-requested', request: committed })
    for (const listener of this.approvals) this.notify(listener, detachValue(committed, 'approval request'))
    return promise
  }

  decideApproval(decision: CoordinationApprovalDecision): void {
    this.assertActive()
    const committed = detachValue(decision, 'approval decision')
    const key = approvalKey(committed)
    const pending = this.pendingApprovals.get(key)
    if (pending === undefined) throw new CoordinationError(`approval gate ${key} is not pending`, 'APPROVAL_PENDING')
    if (committed.prompt !== pending.request.prompt) {
      throw new CoordinationError(`approval decision for ${key} does not match its pending request`, 'INVALID_TASK')
    }
    this.pendingApprovals.delete(key)
    this.emit({ type: 'task/approval-decided', decision: committed })
    pending.resolve(detachValue(committed, 'approval decision'))
  }

  onApprovalRequest(listener: CoordinationApprovalRequestListener): () => void {
    this.assertActive()
    const dispose = this.ctx.effect(() => {
      this.approvals.add(listener)
      return () => this.approvals.delete(listener)
    }, 'coordination.approval-listener')
    return () => { void dispose() }
  }

  onEvent(listener: CoordinationEventListener): () => void {
    this.assertActive()
    const dispose = this.ctx.effect(() => {
      this.events.add(listener)
      return () => this.events.delete(listener)
    }, 'coordination.event-listener')
    return () => { void dispose() }
  }

  private assertActive(): void {
    if (this.disposed) throw new CoordinationError('coordination service is disposed', 'INVALID_TRANSITION')
  }

  private normalizeSpec(spec: TaskSpec): NormalizedTaskSpec {
    if (typeof spec.label !== 'string' || spec.label.trim().length === 0 || typeof spec.executor !== 'string' || spec.executor.trim().length === 0) {
      throw new CoordinationError('task label and executor must be non-empty', 'INVALID_TASK')
    }
    return {
      ...spec,
      id: spec.id ?? TaskId(`task-${randomUUID()}`),
      dependencies: [...spec.dependencies ?? []],
      label: spec.label.trim(),
      executor: spec.executor.trim(),
      input: detachValue(spec.input, 'task input'),
    }
  }

  private validateGraph(specs: readonly NormalizedTaskSpec[]): void {
    const byId = new Map<TaskId, NormalizedTaskSpec>()
    for (const spec of specs) {
      if (byId.has(spec.id)) throw new CoordinationError(`duplicate task ${String(spec.id)}`, 'DUPLICATE_TASK')
      byId.set(spec.id, spec)
    }
    for (const spec of specs) {
      for (const dependency of spec.dependencies) if (!byId.has(dependency)) {
        throw new CoordinationError(`task ${String(spec.id)} depends on missing task ${String(dependency)}`, 'DEPENDENCY_MISSING')
      }
      if (spec.parentId !== undefined && !byId.has(spec.parentId)) {
        throw new CoordinationError(`task ${String(spec.id)} has missing parent ${String(spec.parentId)}`, 'DEPENDENCY_MISSING')
      }
    }
    this.validateAcyclic(
      specs,
      spec => spec.dependencies,
      'dependency',
      'DEPENDENCY_CYCLE',
    )
    this.validateAcyclic(
      specs,
      spec => spec.parentId === undefined ? [] : [spec.parentId],
      'parent',
      'PARENT_CYCLE',
    )
  }

  private validateAcyclic(
    specs: readonly NormalizedTaskSpec[],
    related: (spec: NormalizedTaskSpec) => readonly TaskId[],
    label: 'dependency' | 'parent',
    code: 'DEPENDENCY_CYCLE' | 'PARENT_CYCLE',
  ): void {
    const byId = new Map(specs.map(spec => [spec.id, spec]))
    const visiting = new Set<TaskId>()
    const visited = new Set<TaskId>()
    const visit = (id: TaskId): void => {
      if (visiting.has(id)) throw new CoordinationError(`${label} cycle includes ${String(id)}`, code)
      if (visited.has(id)) return
      visiting.add(id)
      for (const next of related(byId.get(id) as NormalizedTaskSpec)) visit(next)
      visiting.delete(id)
      visited.add(id)
    }
    for (const spec of specs) visit(spec.id)
  }

  private validateExecutors(specs: readonly NormalizedTaskSpec[]): void {
    for (const spec of specs) if (!this.executors.has(spec.executor)) {
      throw new CoordinationError(`executor "${spec.executor}" is unavailable`, 'EXECUTOR_UNAVAILABLE')
    }
  }

  private validateTaskIdsAvailable(specs: readonly NormalizedTaskSpec[]): void {
    for (const spec of specs) if (this.tasks.has(spec.id)) {
      throw new CoordinationError(`task ${String(spec.id)} already exists`, 'DUPLICATE_TASK')
    }
  }

  private installTask(run: MutableRun, spec: NormalizedTaskSpec, retainedBytes: number, announce = true): TaskId {
    const task: MutableTask = {
      id: spec.id,
      runId: run.id,
      label: spec.label,
      dependencies: [...spec.dependencies],
      executor: spec.executor,
      input: spec.input,
      parentId: spec.parentId,
      status: spec.dependencies.length === 0 ? 'ready' : 'pending',
      output: undefined,
      error: undefined,
      createdAt: Date.now(),
      startedAt: undefined,
      finishedAt: undefined,
      controller: undefined,
      cancelRequested: false,
      cancelReason: 'cancelled by caller',
      retainedBytes,
    }
    this.tasks.set(task.id, task)
    run.taskIds.push(task.id)
    this.retainedBytes += retainedBytes
    if (announce) this.emit({ type: 'task/changed', task: this.snapshotTask(task) })
    return task.id
  }

  private queuePump(): void {
    if (this.pumpQueued || this.disposed) return
    this.pumpQueued = true
    queueMicrotask(() => {
      this.pumpQueued = false
      this.pump()
    })
  }

  private pump(): void {
    for (const run of this.runs.values()) {
      if (isTerminalRun(run.status)) continue
      this.propagateBlockedTasks(run)
      this.updateRun(run)
    }
    for (const task of this.tasks.values()) {
      if (this.active >= this.maxConcurrency) break
      if (task.status === 'pending' && task.dependencies.every(id => (this.tasks.get(id) as MutableTask).status === 'succeeded')) this.setStatus(task, 'ready')
      if (task.status === 'ready') this.startExecution(task)
    }
  }

  private startExecution(task: MutableTask): void {
    const execution = this.execute(task)
    this.executions.add(execution)
    void execution.then(
      () => { this.executions.delete(execution) },
      /* v8 ignore next -- execute converts executor failures to task outcomes; only an internal scheduler defect can reject */
      (error: unknown) => {
        this.executions.delete(execution)
        this.ctx.logger.error(`coordination executor lifecycle rejected: ${String(error)}`)
      },
    )
  }

  private async execute(task: MutableTask): Promise<void> {
    const executor = this.executors.get(task.executor)
    if (executor === undefined) {
      this.finish(task, { status: 'failed', error: `executor "${task.executor}" is unavailable` })
      return
    }
    this.active += 1
    // Held locally as well as on the task: a contribution unload can finish
    // this task (clearing task.controller) before the executor's promise
    // settles, and the resumed body below must still read the signal it was
    // handed rather than dereference the cleared field.
    const controller = new AbortController()
    task.controller = controller
    task.startedAt = Date.now()
    this.setStatus(task, 'running')

    let outcome: SettledTaskOutcome
    try {
      const output = await executor(this.snapshotTask(task), controller.signal)
      outcome = task.cancelRequested || controller.signal.aborted
        ? { status: 'cancelled', error: task.cancelReason }
        : normalizeOutcome(output)
    } catch (error: unknown) {
      outcome = task.cancelRequested || controller.signal.aborted
        ? { status: 'cancelled', error: task.cancelReason }
        : { status: 'failed', error: errorMessage(error) }
    }
    this.finish(task, outcome)
  }

  /**
   * Fail every task still `running` under a just-unregistered executor kind.
   * The executor's function reference is gone, so its in-flight promise may
   * never settle; without this the task would hang in `running` and hold its
   * concurrency slot. We abort the controller first (best-effort resource
   * release for an executor that does observe the signal) and then finish the
   * task immediately with the admission-time `unavailable` diagnostic rather
   * than waiting on a promise that no longer has an owner. A late settle of
   * that promise re-enters {@link finish}, which is idempotent on a terminal
   * task, so the slot is never released twice.
   * @param kind - the executor kind whose registration was just disposed.
   */
  private failOrphanedTasks(kind: string): void {
    for (const task of this.tasks.values()) {
      if (task.executor !== kind || task.status !== 'running') continue
      task.controller?.abort(`executor "${kind}" is unavailable`)
      this.finish(task, { status: 'failed', error: `executor "${kind}" is unavailable` })
    }
  }

  private finish(task: MutableTask, outcome: SettledTaskOutcome): void {
    if (isTerminalTask(task.status)) return
    if (task.status === 'running') this.active -= 1
    const retained = this.retainOutcome(outcome)
    task.output = retained.outcome.output
    task.error = retained.outcome.error
    task.retainedBytes += retained.bytes
    this.retainedBytes += retained.bytes
    task.finishedAt = Date.now()
    task.controller = undefined
    this.rejectTaskApprovals(task.id, `task ${String(task.id)} is already terminal`)
    this.setStatus(task, retained.outcome.status)
    const run = this.runs.get(task.runId) as MutableRun
    this.propagateBlockedTasks(run)
    this.updateRun(run)
    this.queuePump()
  }

  private cancelTask(task: MutableTask, reason: string): void {
    if (isTerminalTask(task.status)) return
    task.cancelRequested = true
    task.cancelReason = reason
    this.rejectTaskApprovals(task.id, `task ${String(task.id)} was cancelled`)
    if (task.status === 'running') {
      task.controller?.abort(reason)
      return
    }
    const retained = this.retainOutcome({ status: 'cancelled', error: reason })
    task.output = retained.outcome.output
    task.error = retained.outcome.error
    task.retainedBytes += retained.bytes
    this.retainedBytes += retained.bytes
    task.finishedAt = Date.now()
    this.setStatus(task, retained.outcome.status)
  }

  private propagateBlockedTasks(run: MutableRun): void {
    let changed = true
    while (changed) {
      changed = false
      for (const id of run.taskIds) {
        const task = this.tasks.get(id) as MutableTask
        if (task.status !== 'pending') continue
        if (task.dependencies.some((dependency) => {
          const status = (this.tasks.get(dependency) as MutableTask).status
          return status === 'failed' || status === 'cancelled'
        })) {
          this.cancelTask(task, 'dependency did not succeed')
          changed = true
        }
      }
    }
  }

  private rejectTaskApprovals(taskId: TaskId, message: string): void {
    for (const [key, pending] of this.pendingApprovals) {
      if (pending.request.taskId !== taskId) continue
      this.pendingApprovals.delete(key)
      pending.reject(new CoordinationError(message, 'INVALID_TRANSITION'))
    }
  }

  private setStatus(task: MutableTask, status: TaskStatus): void {
    task.status = status
    this.emit({ type: 'task/changed', task: this.snapshotTask(task) })
    if (status === 'cancelled') this.emit({ type: 'task/cancelled', task: this.snapshotTask(task) })
  }

  private updateRun(run: MutableRun): void {
    if (isTerminalRun(run.status)) return
    const statuses = run.taskIds.map(id => (this.tasks.get(id) as MutableTask).status)
    if (!statuses.every(isTerminalTask)) {
      run.status = statuses.some(status => status === 'running') ? 'running' : run.status
      return
    }
    run.status = statuses.includes('failed') ? 'failed' : run.cancelRequested || statuses.includes('cancelled') ? 'cancelled' : 'succeeded'
    run.finishedAt = Date.now()
    const snapshot = this.snapshotRun(run)
    this.emit({ type: 'run/ended', run: snapshot })
    run.resolve(snapshot)
    this.terminalRuns.push(run.id)
    this.evictTerminalRunsToCount()
  }

  private handle(run: MutableRun): CoordinationRun {
    const snapshot = (): RunSnapshot => this.snapshotRun(run)
    return {
      get snapshot(): RunSnapshot { return snapshot() },
      get result(): Promise<RunSnapshot> {
        return run.result.then(value => detachValue(value, 'run result'))
      },
      cancel: (reason?: string) => { this.cancel(run.id, reason) },
    }
  }

  private snapshotRun(run: MutableRun): RunSnapshot {
    return {
      id: run.id,
      status: run.status,
      taskIds: [...run.taskIds],
      createdAt: run.createdAt,
      ...run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt },
    }
  }

  private snapshotTask(task: MutableTask): TaskSnapshot {
    return {
      id: task.id,
      runId: task.runId,
      label: task.label,
      dependencies: [...task.dependencies],
      executor: task.executor,
      input: detachValue(task.input, 'task input'),
      ...task.parentId === undefined ? {} : { parentId: task.parentId },
      status: task.status,
      ...task.output === undefined ? {} : { output: detachValue(task.output, 'task output') },
      ...task.error === undefined ? {} : { error: task.error },
      createdAt: task.createdAt,
      ...task.startedAt === undefined ? {} : { startedAt: task.startedAt },
      ...task.finishedAt === undefined ? {} : { finishedAt: task.finishedAt },
    }
  }

  private activeRunCount(): number {
    let count = 0
    for (const run of this.runs.values()) if (!isTerminalRun(run.status)) count += 1
    return count
  }

  private ensureCapacity(requiredBytes: number, subject: string): void {
    this.evictTerminalRunsForBytes(requiredBytes)
    if (this.retainedBytes + requiredBytes > this.maxRetainedBytes) {
      throw new CoordinationError(
        `${subject} require ${requiredBytes} serialized bytes, over the remaining coordination retained-byte cap (${this.maxRetainedBytes})`,
        'RESOURCE_LIMIT',
      )
    }
  }

  private retainOutcome(outcome: SettledTaskOutcome): { readonly outcome: SettledTaskOutcome; readonly bytes: number } {
    let bytes: number
    try {
      bytes = retainedByteLength(outcome, 'task outcome')
    } catch (error: unknown) {
      return {
        outcome: {
          status: 'failed',
          error: errorMessage(error),
        },
        bytes: 0,
      }
    }
    this.evictTerminalRunsForBytes(bytes)
    if (this.retainedBytes + bytes <= this.maxRetainedBytes) return { outcome, bytes }
    const error = `task outcome exceeded the coordination retained-byte cap (${this.maxRetainedBytes})`
    if (outcome.status === 'succeeded') return { outcome: { status: 'failed', error }, bytes: 0 }
    return { outcome: { status: outcome.status, error }, bytes: 0 }
  }

  private boundDiagnostic(value: string, label: string): string {
    return retainedByteLength(value, label) <= this.maxRetainedBytes
      ? value
      : `${label} exceeded the coordination retained-byte cap (${this.maxRetainedBytes})`
  }

  private evictTerminalRunsForBytes(requiredBytes: number): void {
    while (this.retainedBytes + requiredBytes > this.maxRetainedBytes && this.terminalRuns.length > 0) {
      this.evictRun(this.terminalRuns.shift() as RunId)
    }
  }

  private evictTerminalRunsToCount(): void {
    while (this.terminalRuns.length > this.maxRetainedRuns) {
      this.evictRun(this.terminalRuns.shift() as RunId)
    }
  }

  private evictRun(runId: RunId): void {
    const run = this.runs.get(runId) as MutableRun
    const snapshot = this.snapshotRun(run)
    for (const taskId of run.taskIds) {
      const task = this.tasks.get(taskId) as MutableTask
      this.retainedBytes -= task.retainedBytes
      this.tasks.delete(taskId)
    }
    this.runs.delete(runId)
    this.emit({ type: 'run/evicted', run: snapshot })
  }

  private specOf(task: MutableTask): NormalizedTaskSpec {
    return {
      id: task.id,
      label: task.label,
      dependencies: task.dependencies,
      executor: task.executor,
      input: task.input,
      ...task.parentId === undefined ? {} : { parentId: task.parentId },
    }
  }

  private emit(event: CoordinationEvent): void {
    for (const listener of this.events) this.notify(listener, detachValue(event, 'coordination event'))
  }

  private notify<T>(listener: (value: T) => unknown, value: T): void {
    try {
      void Promise.resolve(listener(value)).catch((error: unknown) => {
        this.ctx.logger.warn(`coordination listener rejected: ${String(error)}`)
      })
    } catch (error: unknown) {
      this.ctx.logger.warn(`coordination listener threw: ${String(error)}`)
    }
  }

  private throwError(message: string, code: 'UNKNOWN_RUN' | 'UNKNOWN_TASK'): never {
    throw new CoordinationError(message, code)
  }
}

function approvalKey(request: Pick<CoordinationApprovalRequest, 'taskId' | 'gateId'>): string {
  return `${String(request.taskId)}:${request.gateId}`
}

function normalizeOutcome(value: TaskOutcome): { status: 'succeeded'; output?: unknown } | { status: 'failed'; error: string } | { status: 'cancelled'; error?: string } {
  switch (value.status) {
    case 'succeeded':
      return value.output === undefined
        ? { status: 'succeeded' }
        : { status: 'succeeded', output: detachValue(value.output, 'task output') }
    case 'failed': return { status: 'failed', error: value.error }
    case 'cancelled': return { status: 'cancelled', ...value.error === undefined ? {} : { error: value.error } }
  }
}

function detachValue<T>(value: T, label: string): T {
  try {
    return structuredClone(value)
  } catch (error: unknown) {
    throw new CoordinationError(`${label} must be structured-cloneable`, 'INVALID_TASK', { cause: error })
  }
}

function retainedByteLength(value: unknown, label: string): number {
  try {
    return serialize(value).byteLength
  } catch (error: unknown) {
    throw new CoordinationError(`${label} must be serializable for retained-byte accounting`, 'INVALID_TASK', { cause: error })
  }
}

export default LocalCoordinationService
