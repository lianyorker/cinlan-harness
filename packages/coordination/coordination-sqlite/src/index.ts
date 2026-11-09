/**
 * SQLite-durable implementation of the task-coordination capability.
 *
 * Every state transition is written to a per-record journal unit through the
 * storage key-value facet before it reaches memory, listeners, or executors
 * (write-ahead logging). On startup the service folds the journal back into
 * memory, fails tasks that were `running` when the process died (their
 * executors are gone and re-dispatching them would repeat side effects),
 * lets not-yet-running tasks continue from their recorded state, and never
 * restores listeners or pending approvals.
 *
 * Scheduling semantics mirror the local in-memory provider: same caps,
 * same eviction and cancellation propagation, same outcome handling. The
 * difference is that each transition passes an explicit status-transition
 * table and one journal write first, so an interrupted process resumes into
 * a consistent state instead of losing or duplicating work.
 * @module
 */
import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  approvalKey,
  CoordinationError,
  CoordinationService,
  detachValue,
  errorMessage,
  isTerminalRun,
  isTerminalTask,
  normalizeOutcome,
  normalizeSpec,
  retainedByteLength,
  RunId,
  TaskId,
  validateGraph,
} from '@cinlan/coordination'
import type {
  CoordinationApprovalDecision,
  CoordinationApprovalRequest,
  CoordinationApprovalRequestListener,
  CoordinationEvent,
  CoordinationEventListener,
  CoordinationRun,
  NormalizedTaskSpec,
  RunSnapshot,
  RunStatus,
  SettledTaskOutcome,
  StartRunRequest,
  TaskExecutor,
  TaskMessage,
  TaskMessageListener,
  TaskSnapshot,
  TaskSpec,
  TaskStatus,
} from '@cinlan/coordination'
import type { KvUnit, StorageBackend } from '@deepseek-ai/dsh-storage'
import { JOURNAL_UNIT, journalKey } from './schema.ts'
import type { JournalEntry } from './schema.ts'
import { assertRunTransition, assertTaskTransition } from './transitions.ts'

export { JOURNAL_UNIT, journalKey } from './schema.ts'
export type { JournalEntry } from './schema.ts'
export { RUN_TRANSITIONS, TASK_TRANSITIONS } from './transitions.ts'

/** Provider configuration. Scheduling caps mirror the local provider; the journal location is new. */
export interface Config {
  maxConcurrency?: number
  maxActiveRuns?: number
  maxTasksPerRun?: number
  maxRetainedRuns?: number
  maxRetainedBytes?: number
  /** Registered storage backend serving the journal unit (default `sqlite`). */
  backend?: string
  /** Journal unit name (default `coordination`). */
  unit?: string
}

interface MutableRun {
  id: RunId
  taskIds: TaskId[]
  createdAt: number
  status: RunStatus
  finishedAt?: number
  resolve: (snapshot: RunSnapshot) => void
  result: Promise<RunSnapshot>
  cancelRequested: boolean
}

interface MutableTask {
  id: TaskId
  runId: RunId
  label: string
  dependencies: TaskId[]
  executor: string
  input?: unknown
  parentId?: TaskId
  status: TaskStatus
  output?: unknown
  error?: string
  createdAt: number
  startedAt?: number
  finishedAt?: number
  controller?: AbortController
  cancelRequested: boolean
  cancelReason: string
  retainedBytes: number
}

interface PendingApproval {
  request: CoordinationApprovalRequest
  resolve: (decision: CoordinationApprovalDecision) => void
  reject: (error: unknown) => void
}

/**
 * Reject values the JSON journal cannot round-trip: functions and symbols are
 * dropped silently by `JSON.stringify`, and non-finite numbers become `null`,
 * so a plain stringify is not enough — the replacer rethrows on non-finite
 * numbers and the round-trip comparison catches dropped members.
 */
function assertJsonSerializable(value: unknown, label: string): void {
  // An absent input is legal: it round-trips as the journal's `undefined`.
  if (value === undefined) return
  let text: string
  try {
    text = JSON.stringify(value, (_key, staged: unknown) => {
      if (typeof staged === 'number' && !Number.isFinite(staged)) throw new TypeError('non-finite number')
      return staged
    }) as string
  } catch (error: unknown) {
    throw new CoordinationError(`${label} must be JSON-serializable`, 'INVALID_TASK', { cause: error })
  }
  if (text === undefined) throw new CoordinationError(`${label} must be JSON-serializable`, 'INVALID_TASK')
  try {
    if (JSON.stringify(JSON.parse(text) as unknown) !== text) {
      throw new CoordinationError(`${label} must be JSON-serializable`, 'INVALID_TASK')
    }
  } catch (error: unknown) {
    if (error instanceof CoordinationError) throw error
    throw new CoordinationError(`${label} must be JSON-serializable`, 'INVALID_TASK', { cause: error })
  }
}

/** SQLite-durable task-coordination provider. */
export class SqliteCoordinationService extends CoordinationService {
  static Config: z<Config> = z.object({
    maxConcurrency: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(4),
    maxActiveRuns: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16),
    maxTasksPerRun: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(128),
    maxRetainedRuns: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(32),
    maxRetainedBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16_777_216),
    backend: z.string().default('sqlite'),
    unit: z.string().default('coordination'),
  })

  /** The journal lives on the storage hub's backend registry. */
  static inject = ['storage']

  private readonly maxConcurrency: number
  private readonly maxActiveRuns: number
  private readonly maxTasksPerRun: number
  private readonly maxRetainedRuns: number
  private readonly maxRetainedBytes: number
  private readonly backendName: string
  private readonly unitName: string
  private readonly runs = new Map<RunId, MutableRun>()
  private readonly tasks = new Map<TaskId, MutableTask>()
  private readonly terminalRuns: RunId[] = []
  private readonly executors = new Map<string, TaskExecutor>()
  private readonly events = new Set<CoordinationEventListener>()
  private readonly messages = new Set<TaskMessageListener>()
  private readonly approvals = new Set<CoordinationApprovalRequestListener>()
  private readonly pendingApprovals = new Map<string, PendingApproval>()
  private readonly executions = new Set<Promise<void>>()
  /** Serializes read-modify-write transitions; every journal commit happens inside one op. */
  private ops: Promise<unknown> = Promise.resolve()
  /** Serializes journal writes; ordering inside an op is preserved end to end. */
  private journalChain: Promise<void> = Promise.resolve()
  /** First journal-write failure poisons every later op: durable state is unknown, so stop. */
  private journalFailure: CoordinationError | undefined
  private active = 0
  private retainedBytes = 0
  private nextSeq = 1
  private pumpQueued = false
  private disposed = false
  private initialized = false
  private unit: KvUnit | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx)
    const resolved = config as Required<Config>
    this.maxConcurrency = resolved.maxConcurrency
    this.maxActiveRuns = resolved.maxActiveRuns
    this.maxTasksPerRun = resolved.maxTasksPerRun
    this.maxRetainedRuns = resolved.maxRetainedRuns
    this.maxRetainedBytes = resolved.maxRetainedBytes
    this.backendName = resolved.backend
    this.unitName = resolved.unit
    ctx.effect(() => async () => { await this.dispose() }, 'coordination.dispose')
  }

  /** Fold the journal back into memory before the plugin resolves, so callers never observe a half-recovered service. */
  protected async [Service.init](): Promise<void> {
    const backend = this.ctx.storage.backend.get(this.backendName) as StorageBackend
    const facet = backend.kv
    if (facet === undefined) {
      throw new CoordinationError(`storage backend "${this.backendName}" does not serve the key-value facet`, 'INVALID_TRANSITION')
    }
    this.unit = await facet.open({ ...JOURNAL_UNIT, name: this.unitName })
    await this.recover()
    this.initialized = true
    this.queuePump(true)
  }

  registerExecutor(kind: string, executor: TaskExecutor): () => void {
    this.assertReady()
    const normalizedKind = kind.trim()
    if (normalizedKind.length === 0) throw new CoordinationError('executor kind must be non-empty', 'INVALID_TASK')
    if (this.executors.has(normalizedKind)) throw new CoordinationError(`executor "${normalizedKind}" is already registered`, 'INVALID_TASK')
    const dispose = this.ctx.effect(() => {
      this.executors.set(normalizedKind, executor)
      return () => {
        this.executors.delete(normalizedKind)
        // A contribution can unload while the service stays alive (provider
        // removed, HMR reload); tasks left `running` under this kind would
        // hang forever on a promise that no longer has an owner.
        this.failOrphanedTasks(normalizedKind)
      }
    }, 'coordination.executor')
    return () => { void dispose() }
  }

  async start(request: StartRunRequest): Promise<CoordinationRun> {
    this.assertReady()
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
    const specs = request.tasks.map(spec => normalizeSpec(spec))
    validateGraph(specs)
    this.validateTaskIdsAvailable(specs)
    this.validateExecutors(specs)
    for (const spec of specs) assertJsonSerializable(spec.input, 'task input')
    const specBytes = specs.map(spec => retainedByteLength(spec, 'task declaration'))
    const totalBytes = specBytes.reduce((total, bytes) => total + bytes, 0)
    this.ensureCapacitySync(totalBytes, 'run task declarations')
    let resolveRun!: (snapshot: RunSnapshot) => void
    const result = new Promise<RunSnapshot>((resolve) => { resolveRun = resolve })
    return this.enqueue(async () => {
      await this.ensureCapacityInOp(totalBytes, 'run task declarations')
      const createdAt = Date.now()
      const run: MutableRun = {
        id: runId,
        taskIds: [],
        createdAt,
        status: 'running',
        resolve: resolveRun,
        result,
        cancelRequested: false,
      }
      const created = specs.map((spec, index) => this.buildTask(runId, spec, specBytes[index] as number))
      const runSnapshot: RunSnapshot = {
        id: runId,
        status: 'running',
        taskIds: created.map(task => task.id),
        createdAt,
      }
      await this.commit({ type: 'run/started', run: runSnapshot })
      const taskSnapshots = created.map(task => this.snapshotTask(task))
      for (const snapshot of taskSnapshots) await this.commit({ type: 'task/changed', task: snapshot })
      this.runs.set(runId, run)
      for (const [index, task] of created.entries()) {
        this.tasks.set(task.id, task)
        run.taskIds.push(task.id)
        this.retainedBytes += specBytes[index] as number
      }
      this.emit({ type: 'run/started', run: runSnapshot })
      for (const snapshot of taskSnapshots) this.emit({ type: 'task/changed', task: snapshot })
      this.queuePump()
      return this.handle(run)
    })
  }

  getRun(id: RunId): RunSnapshot {
    this.assertReady()
    const run = this.runs.get(id)
    if (run === undefined) throw new CoordinationError(`unknown run ${String(id)}`, 'UNKNOWN_RUN')
    return detachValue(this.snapshotRun(run), 'run snapshot')
  }

  getTask(id: TaskId): TaskSnapshot {
    this.assertReady()
    const task = this.tasks.get(id)
    if (task === undefined) throw new CoordinationError(`unknown task ${String(id)}`, 'UNKNOWN_TASK')
    return detachValue(this.snapshotTask(task), 'task snapshot')
  }

  listTasks(runId: RunId): TaskSnapshot[] {
    const run = this.runs.get(runId)
    if (run === undefined) throw new CoordinationError(`unknown run ${String(runId)}`, 'UNKNOWN_RUN')
    return run.taskIds.map(id => this.getTask(id))
  }

  async addTask(runId: RunId, spec: TaskSpec): Promise<TaskId> {
    this.assertReady()
    const run = this.runs.get(runId)
    if (run === undefined) throw new CoordinationError(`unknown run ${String(runId)}`, 'UNKNOWN_RUN')
    if (isTerminalRun(run.status)) throw new CoordinationError(`run ${String(runId)} is already terminal`, 'INVALID_TRANSITION')
    if (run.taskIds.length >= this.maxTasksPerRun) {
      throw new CoordinationError(`run ${String(runId)} reached its task cap (${this.maxTasksPerRun})`, 'RESOURCE_LIMIT')
    }
    const normalized = normalizeSpec(spec)
    this.validateTaskIdsAvailable([normalized])
    const specs = run.taskIds.map(id => this.specOf(this.tasks.get(id) as MutableTask))
    specs.push(normalized)
    validateGraph(specs)
    this.validateExecutors([normalized])
    assertJsonSerializable(normalized.input, 'task input')
    const specBytes = retainedByteLength(normalized, 'task declaration')
    this.ensureCapacitySync(specBytes, 'task declaration')
    return this.enqueue(async () => {
      await this.ensureCapacityInOp(specBytes, 'task declaration')
      const created = this.buildTask(runId, normalized, specBytes)
      const snapshot = this.snapshotTask(created)
      await this.commit({ type: 'task/changed', task: snapshot })
      this.tasks.set(created.id, created)
      run.taskIds.push(created.id)
      this.retainedBytes += specBytes
      this.emit({ type: 'task/changed', task: snapshot })
      await this.propagateBlockedTasksInOp(run)
      await this.updateRunInOp(run)
      this.queuePump()
      return created.id
    })
  }

  cancel(target: RunId | TaskId, reason = 'cancelled by caller'): void {
    this.assertReady()
    const retainedReason = this.boundDiagnostic(reason, 'cancellation reason')
    const run = this.runs.get(target as RunId)
    if (run !== undefined) {
      if (isTerminalRun(run.status)) return
      run.cancelRequested = true
      void this.enqueue(async () => {
        for (const id of run.taskIds) await this.cancelTaskInOp(this.tasks.get(id) as MutableTask, retainedReason)
        await this.updateRunInOp(run)
      })
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
    void this.enqueue(async () => {
      for (const id of subtree) await this.cancelTaskInOp(this.tasks.get(id) as MutableTask, retainedReason)
      const owningRun = this.runs.get(task.runId) as MutableRun
      await this.propagateBlockedTasksInOp(owningRun)
      await this.updateRunInOp(owningRun)
    })
  }

  async sendMessage(taskId: TaskId, message: string, sender?: string): Promise<TaskMessage> {
    this.assertReady()
    this.getTask(taskId)
    if (message.trim().length === 0) throw new CoordinationError('task message must be non-empty', 'INVALID_TASK')
    const record: TaskMessage = { taskId, message, ...sender === undefined ? {} : { sender }, createdAt: Date.now() }
    const committed = detachValue(record, 'task message')
    await this.enqueue(async () => {
      await this.commit({ type: 'task/message', message: committed })
      this.emit({ type: 'task/message', message: committed })
      for (const listener of this.messages) this.notify(listener, detachValue(committed, 'task message'))
    })
    return detachValue(committed, 'task message')
  }

  /**
   * Pending approvals are installed synchronously so duplicate-gate and
   * prompt-mismatch checks stay synchronous like the local provider, but the
   * journal write happens in the op chain first: the requester's promise and
   * the adapter callback only settle after the entry is durable.
   */
  requestApproval(request: CoordinationApprovalRequest): Promise<CoordinationApprovalDecision> {
    this.assertReady()
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
    void this.enqueue(async () => {
      await this.commit({ type: 'task/approval-requested', request: committed })
      this.emit({ type: 'task/approval-requested', request: committed })
      for (const adapter of this.approvals) this.notify(adapter, detachValue(committed, 'approval request'))
    }).then(() => {}, (error: unknown) => {
      const pending = this.pendingApprovals.get(key)
      if (pending !== undefined && pending.request === committed) {
        this.pendingApprovals.delete(key)
        pending.reject(error)
      }
    })
    return promise
  }

  decideApproval(decision: CoordinationApprovalDecision): void {
    this.assertReady()
    const committed = detachValue(decision, 'approval decision')
    const key = approvalKey(committed)
    const pending = this.pendingApprovals.get(key)
    if (pending === undefined) throw new CoordinationError(`approval gate ${key} is not pending`, 'APPROVAL_PENDING')
    if (committed.prompt !== pending.request.prompt) {
      throw new CoordinationError(`approval decision for ${key} does not match its pending request`, 'INVALID_TASK')
    }
    this.pendingApprovals.delete(key)
    void this.enqueue(async () => {
      await this.commit({ type: 'task/approval-decided', decision: committed })
      this.emit({ type: 'task/approval-decided', decision: committed })
      pending.resolve(detachValue(committed, 'approval decision'))
    })
  }

  onEvent(listener: CoordinationEventListener): () => void {
    this.assertReady()
    const dispose = this.ctx.effect(() => {
      this.events.add(listener)
      return () => { this.events.delete(listener) }
    }, 'coordination.event-listener')
    return () => { void dispose() }
  }

  onMessage(listener: TaskMessageListener): () => void {
    this.assertReady()
    const dispose = this.ctx.effect(() => {
      this.messages.add(listener)
      return () => { this.messages.delete(listener) }
    }, 'coordination.message-listener')
    return () => { void dispose() }
  }

  onApprovalRequest(listener: CoordinationApprovalRequestListener): () => void {
    this.assertReady()
    const dispose = this.ctx.effect(() => {
      this.approvals.add(listener)
      return () => { this.approvals.delete(listener) }
    }, 'coordination.approval-listener')
    return () => { void dispose() }
  }

  private assertReady(): void {
    if (!this.initialized) throw new CoordinationError('coordination service is still recovering its journal', 'INVALID_TRANSITION')
    if (this.disposed) throw new CoordinationError('coordination service is disposed', 'INVALID_TRANSITION')
  }

  /**
   * Run one read-modify-write transition at a time. A journal failure poisons
   * the chain: once a write has failed the durable state is unknown, so later
   * transitions refuse to run instead of diverging from the medium.
   */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = this.ops.then(() => {
      if (this.journalFailure !== undefined) throw this.journalFailure
      return op()
    })
    this.ops = result.then(() => {}, () => {})
    return result
  }

  /** Append one journal entry and resolve only after the medium has it. */
  private commit(event: CoordinationEvent): Promise<void> {
    const unit = this.unit
    if (unit === undefined) {
      return Promise.reject(new CoordinationError('coordination journal unit is not open', 'INVALID_TRANSITION'))
    }
    const seq = this.nextSeq
    this.nextSeq += 1
    const entry: JournalEntry = {
      seq,
      event,
      at: Date.now(),
      submissionId: `jnl/${journalKey(seq)}`,
      resultDigest: createHash('sha256').update(JSON.stringify(event)).digest('hex'),
    }
    const write = this.journalChain.then(() => unit.putRecord('journal', journalKey(seq), entry))
    this.journalChain = write.then(() => {}, (error: unknown) => {
      if (this.journalFailure === undefined) {
        this.journalFailure = new CoordinationError(`coordination journal write failed: ${errorMessage(error)}`, 'INVALID_TRANSITION', { cause: error })
      }
    })
    return write
  }

  private async recover(): Promise<void> {
    const loaded = await (this.unit as KvUnit).loadAll()
    const records = loaded.tables.journal ?? {}
    const entries: JournalEntry[] = []
    for (const [key, value] of Object.entries(records)) {
      entries.push(this.asJournalEntry(key, value))
    }
    entries.sort((left, right) => left.seq - right.seq)
    for (const entry of entries) this.applyReplay(entry)
    if (entries.length > 0) this.nextSeq = (entries[entries.length - 1] as JournalEntry).seq + 1
    // Tasks that were mid-flight have no executor anymore: settle them as
    // failed without re-dispatching, then let propagation and run derivation
    // fold the consequences through the normal journaled transitions.
    for (const task of [...this.tasks.values()]) {
      if (task.status === 'running') await this.finishInOp(task, { status: 'failed', error: 'execution interrupted by process restart' })
    }
    for (const run of [...this.runs.values()]) await this.updateRunInOp(run)
  }

  /** Malformed or tampered records fail startup loudly instead of being skipped. */
  private asJournalEntry(key: string, value: unknown): JournalEntry {
    if (value === null || typeof value !== 'object') {
      throw new CoordinationError(`coordination journal record at ${key} is not an object`, 'INVALID_TRANSITION')
    }
    const entry = value as JournalEntry
    if (typeof entry.seq !== 'number' || entry.seq < 1 || !Number.isInteger(entry.seq) || journalKey(entry.seq) !== key) {
      throw new CoordinationError(`coordination journal record at ${key} has an invalid sequence`, 'INVALID_TRANSITION')
    }
    if (
      entry.event === undefined
      || typeof entry.at !== 'number'
      || typeof entry.submissionId !== 'string'
      || typeof entry.resultDigest !== 'string'
    ) {
      throw new CoordinationError(`coordination journal record at ${key} is missing envelope fields`, 'INVALID_TRANSITION')
    }
    return entry
  }

  /**
   * Replay folds every journaled event through the same semantics the live
   * path used, validating consecutive snapshots against the transition
   * tables. Listeners and pending approvals are deliberately not restored:
   * events fire once at their commit time, and a gate that was pending when
   * the process died is re-requested by the resumed workflow.
   */
  private applyReplay(entry: JournalEntry): void {
    const event = entry.event
    switch (event.type) {
      case 'run/started': this.replayRunStart(event.run); return
      case 'run/ended': this.replayRunEnd(event.run); return
      case 'run/evicted': this.replayRunEvicted(event.run); return
      case 'task/changed': this.replayTaskChanged(event.task); return
      case 'task/cancelled': this.replayTaskCancelled(event.task); return
      case 'task/message': return
      case 'task/approval-requested': return
      case 'task/approval-decided': return
    }
  }

  private replayRunStart(run: RunSnapshot): void {
    if (this.runs.has(run.id)) {
      throw new CoordinationError(`coordination journal replays run ${String(run.id)} twice`, 'INVALID_TRANSITION')
    }
    let resolveRun!: (snapshot: RunSnapshot) => void
    const result = new Promise<RunSnapshot>((resolve) => { resolveRun = resolve })
    this.runs.set(run.id, {
      id: run.id,
      taskIds: [...run.taskIds],
      createdAt: run.createdAt,
      status: run.status,
      ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt }),
      resolve: resolveRun,
      result,
      cancelRequested: false,
    })
  }

  private replayRunEnd(run: RunSnapshot): void {
    const existing = this.runs.get(run.id)
    if (existing === undefined) {
      throw new CoordinationError(`coordination journal ends unknown run ${String(run.id)}`, 'INVALID_TRANSITION')
    }
    assertRunTransition(existing.status, run.status)
    existing.status = run.status
    if (run.finishedAt !== undefined) existing.finishedAt = run.finishedAt
    existing.resolve(run)
    this.terminalRuns.push(run.id)
  }

  private replayRunEvicted(run: RunSnapshot): void {
    const existing = this.runs.get(run.id)
    if (existing === undefined) {
      throw new CoordinationError(`coordination journal evicts unknown run ${String(run.id)}`, 'INVALID_TRANSITION')
    }
    for (const taskId of existing.taskIds) {
      const task = this.tasks.get(taskId)
      if (task !== undefined) {
        this.retainedBytes -= task.retainedBytes
        this.tasks.delete(taskId)
      }
    }
    this.runs.delete(run.id)
    const index = this.terminalRuns.indexOf(run.id)
    if (index >= 0) this.terminalRuns.splice(index, 1)
  }

  private replayTaskChanged(task: TaskSnapshot): void {
    const existing = this.tasks.get(task.id)
    if (existing === undefined) {
      if (this.runs.get(task.runId) === undefined) {
        throw new CoordinationError(`coordination journal installs task ${String(task.id)} into unknown run ${String(task.runId)}`, 'INVALID_TRANSITION')
      }
      if (task.status !== 'pending' && task.status !== 'ready') {
        throw new CoordinationError(`coordination journal installs task ${String(task.id)} in non-initial status ${task.status}`, 'INVALID_TRANSITION')
      }
      const bytes = retainedByteLength(this.declarationOf(task), 'task declaration')
      this.tasks.set(task.id, {
        id: task.id,
        runId: task.runId,
        label: task.label,
        dependencies: [...task.dependencies],
        executor: task.executor,
        ...(task.input === undefined ? {} : { input: task.input }),
        ...(task.parentId === undefined ? {} : { parentId: task.parentId }),
        status: task.status,
        output: task.output,
        ...(task.error === undefined ? {} : { error: task.error }),
        createdAt: task.createdAt,
        ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }),
        ...(task.finishedAt === undefined ? {} : { finishedAt: task.finishedAt }),
        cancelRequested: false,
        cancelReason: 'cancelled by caller',
        retainedBytes: bytes,
      })
      this.retainedBytes += bytes
      return
    }
    assertTaskTransition(existing.status, task.status)
    existing.status = task.status
    existing.output = task.output
    if (task.error !== undefined) existing.error = task.error
    if (existing.startedAt === undefined && task.startedAt !== undefined) existing.startedAt = task.startedAt
    if (isTerminalTask(task.status)) {
      const outcome: SettledTaskOutcome = {
        status: task.status,
        ...(task.output === undefined ? {} : { output: task.output }),
        ...(task.error === undefined ? {} : { error: task.error }),
      }
      const bytes = retainedByteLength(outcome, 'task outcome')
      existing.retainedBytes += bytes
      this.retainedBytes += bytes
      if (task.finishedAt !== undefined) existing.finishedAt = task.finishedAt
    }
  }

  private replayTaskCancelled(task: TaskSnapshot): void {
    const existing = this.tasks.get(task.id)
    if (existing === undefined) {
      throw new CoordinationError(`coordination journal cancels unknown task ${String(task.id)}`, 'INVALID_TRANSITION')
    }
    if (!isTerminalTask(existing.status)) {
      throw new CoordinationError(`coordination journal cancels non-terminal task ${String(task.id)}`, 'INVALID_TRANSITION')
    }
    existing.cancelRequested = true
  }

  private async setStatusInOp(task: MutableTask, status: TaskStatus): Promise<void> {
    assertTaskTransition(task.status, status)
    const snapshot: TaskSnapshot = { ...this.snapshotTask(task), status }
    await this.commit({ type: 'task/changed', task: snapshot })
    task.status = status
    this.emit({ type: 'task/changed', task: snapshot })
  }

  /** Journal a terminal task snapshot; a cancellation additionally journals the explicit cancelled event. */
  private async commitTaskSnapshot(snapshot: TaskSnapshot, cancelled: boolean): Promise<void> {
    await this.commit({ type: 'task/changed', task: snapshot })
    if (cancelled) await this.commit({ type: 'task/cancelled', task: snapshot })
  }

  private emitTaskSnapshot(snapshot: TaskSnapshot, cancelled: boolean): void {
    this.emit({ type: 'task/changed', task: snapshot })
    if (cancelled) this.emit({ type: 'task/cancelled', task: snapshot })
  }

  private async finishInOp(task: MutableTask, outcome: SettledTaskOutcome): Promise<void> {
    if (isTerminalTask(task.status)) return
    if (task.status === 'running') this.active -= 1
    const retained = await this.retainOutcomeInOp(outcome)
    const finishedAt = Date.now()
    const snapshot: TaskSnapshot = {
      ...this.snapshotTask(task),
      status: retained.outcome.status,
      ...(retained.outcome.output === undefined ? {} : { output: retained.outcome.output }),
      ...(retained.outcome.error === undefined ? {} : { error: retained.outcome.error }),
      finishedAt,
    }
    await this.commitTaskSnapshot(snapshot, retained.outcome.status === 'cancelled')
    task.status = retained.outcome.status
    task.output = retained.outcome.output
    if (retained.outcome.error !== undefined) task.error = retained.outcome.error
    task.retainedBytes += retained.bytes
    this.retainedBytes += retained.bytes
    task.finishedAt = finishedAt
    this.rejectTaskApprovals(task.id, `task ${String(task.id)} is already terminal`)
    this.emitTaskSnapshot(snapshot, retained.outcome.status === 'cancelled')
    const run = this.runs.get(task.runId) as MutableRun
    await this.propagateBlockedTasksInOp(run)
    await this.updateRunInOp(run)
    this.queuePump()
  }

  /**
   * Mirror of the local cancelTask: a running task is only flagged and
   * aborted here — its terminal journal entry comes from the executor's
   * settle via {@link finishInOp}; non-running tasks settle immediately.
   */
  private async cancelTaskInOp(task: MutableTask, reason: string): Promise<void> {
    if (isTerminalTask(task.status)) return
    task.cancelRequested = true
    task.cancelReason = reason
    this.rejectTaskApprovals(task.id, `task ${String(task.id)} was cancelled`)
    if (task.status === 'running') {
      task.controller?.abort(reason)
      return
    }
    const retained = await this.retainOutcomeInOp({ status: 'cancelled', error: reason })
    const finishedAt = Date.now()
    const snapshot: TaskSnapshot = {
      ...this.snapshotTask(task),
      status: 'cancelled',
      ...(retained.outcome.error === undefined ? {} : { error: retained.outcome.error }),
      finishedAt,
    }
    await this.commitTaskSnapshot(snapshot, true)
    task.status = 'cancelled'
    task.output = retained.outcome.output
    if (retained.outcome.error !== undefined) task.error = retained.outcome.error
    task.retainedBytes += retained.bytes
    this.retainedBytes += retained.bytes
    task.finishedAt = finishedAt
    this.emitTaskSnapshot(snapshot, true)
  }

  private async failTaskInOp(task: MutableTask, message: string): Promise<void> {
    await this.finishInOp(task, { status: 'failed', error: message })
  }

  private async propagateBlockedTasksInOp(run: MutableRun): Promise<void> {
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
          await this.cancelTaskInOp(task, 'dependency did not succeed')
          changed = true
        }
      }
    }
  }

  private rejectTaskApprovals(taskId: TaskId, message: string): void {
    for (const [key, pending] of [...this.pendingApprovals]) {
      if (pending.request.taskId !== taskId) continue
      this.pendingApprovals.delete(key)
      pending.reject(new CoordinationError(message, 'INVALID_TRANSITION'))
    }
  }

  private async updateRunInOp(run: MutableRun): Promise<void> {
    if (isTerminalRun(run.status)) return
    const statuses = run.taskIds.map(id => (this.tasks.get(id) as MutableTask).status)
    if (!statuses.every(isTerminalTask)) return
    const derived: RunStatus = statuses.includes('failed')
      ? 'failed'
      : run.cancelRequested || statuses.includes('cancelled') ? 'cancelled' : 'succeeded'
    assertRunTransition(run.status, derived)
    const finishedAt = Date.now()
    const snapshot: RunSnapshot = {
      id: run.id,
      status: derived,
      taskIds: [...run.taskIds],
      createdAt: run.createdAt,
      finishedAt,
    }
    await this.commit({ type: 'run/ended', run: snapshot })
    run.status = derived
    run.finishedAt = finishedAt
    this.emit({ type: 'run/ended', run: snapshot })
    run.resolve(detachValue(snapshot, 'run result'))
    this.terminalRuns.push(run.id)
    await this.evictTerminalRunsToCountInOp()
  }

  private queuePump(recovered = false): void {
    if (this.pumpQueued || this.disposed || !this.initialized) return
    this.pumpQueued = true
    queueMicrotask(() => {
      this.pumpQueued = false
      void this.enqueue(() => this.pumpOnce(recovered)).then(() => {}, (error: unknown) => {
        this.ctx.logger.error(`coordination pump rejected: ${String(error)}`)
      })
    })
  }

  private async pumpOnce(recovered = false): Promise<void> {
    for (const run of [...this.runs.values()]) {
      if (isTerminalRun(run.status)) continue
      await this.propagateBlockedTasksInOp(run)
      await this.updateRunInOp(run)
    }
    for (const task of [...this.tasks.values()]) {
      if (this.active >= this.maxConcurrency) break
      if (task.status === 'pending' && task.dependencies.every(id => (this.tasks.get(id) as MutableTask).status === 'succeeded')) {
        await this.setStatusInOp(task, 'ready')
      }
      if (task.status === 'ready') {
        const executor = this.executors.get(task.executor)
        if (executor === undefined) {
          // The recovery pump runs before consumer effects have registered
          // executors for this process; failing admitted work there would
          // destroy recoverable tasks on a registration-window race. Leave
          // them ready for the next pump, which fails them like any other
          // dispatch once the window is over.
          if (recovered) continue
          await this.failTaskInOp(task, `executor "${task.executor}" is unavailable`)
          continue
        }
        this.active += 1
        // Held locally as well as on the task: a contribution unload can
        // finish this task before the executor's promise settles, and the
        // resumed body must still read the signal it was handed.
        const controller = new AbortController()
        task.controller = controller
        task.startedAt = Date.now()
        await this.setStatusInOp(task, 'running')
        this.trackExecution(this.awaitExecutor(task, executor, controller))
      }
    }
  }

  private trackExecution(execution: Promise<void>): void {
    this.executions.add(execution)
    void execution.then(
      () => { this.executions.delete(execution) },
      (error: unknown) => {
        this.executions.delete(execution)
        this.ctx.logger.error(`coordination executor lifecycle rejected: ${String(error)}`)
      },
    )
  }

  private async awaitExecutor(task: MutableTask, executor: TaskExecutor, controller: AbortController): Promise<void> {
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
    await this.enqueue(() => this.finishInOp(task, outcome))
    this.queuePump()
  }

  private failOrphanedTasks(kind: string): void {
    void this.enqueue(async () => {
      for (const task of [...this.tasks.values()]) {
        if (task.executor !== kind || task.status !== 'running') continue
        // Journal the terminal settle before delivering the abort signal:
        // the write is the source of truth, the abort is best-effort release.
        const controller = task.controller
        await this.finishInOp(task, { status: 'failed', error: `executor "${kind}" is unavailable` })
        controller?.abort(`executor "${kind}" is unavailable`)
      }
    })
  }

  private activeRunCount(): number {
    return [...this.runs.values()].filter(run => !isTerminalRun(run.status)).length
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

  /**
   * Synchronous pre-check of the retained-byte cap. It throws immediately
   * when eviction could not help (no terminal runs); when terminal runs
   * exist, the actual eviction happens inside the op so its journal entries
   * stay ordered with the transition that needs the room.
   */
  private ensureCapacitySync(requiredBytes: number, subject: string): void {
    if (this.retainedBytes + requiredBytes <= this.maxRetainedBytes) return
    if (this.terminalRuns.length === 0) {
      throw new CoordinationError(`${subject} require ${requiredBytes} serialized bytes, over the coordination retained-byte cap (${this.maxRetainedBytes})`, 'RESOURCE_LIMIT')
    }
  }

  private async ensureCapacityInOp(requiredBytes: number, subject: string): Promise<void> {
    await this.evictTerminalRunsForBytesInOp(requiredBytes)
    if (this.retainedBytes + requiredBytes > this.maxRetainedBytes) {
      throw new CoordinationError(`${subject} require ${requiredBytes} serialized bytes, over the coordination retained-byte cap (${this.maxRetainedBytes})`, 'RESOURCE_LIMIT')
    }
  }

  private async retainOutcomeInOp(outcome: SettledTaskOutcome): Promise<{ readonly outcome: SettledTaskOutcome; readonly bytes: number }> {
    // The journal stores JSON, so an outcome that cannot survive a round trip
    // degrades into a bounded failed outcome exactly like an oversized one.
    try {
      assertJsonSerializable(outcome, 'task outcome')
    } catch (error: unknown) {
      return { outcome: { status: 'failed', error: errorMessage(error) }, bytes: 0 }
    }
    let bytes: number
    try {
      bytes = retainedByteLength(outcome, 'task outcome')
    } catch (error: unknown) {
      return { outcome: { status: 'failed', error: errorMessage(error) }, bytes: 0 }
    }
    await this.evictTerminalRunsForBytesInOp(bytes)
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

  private async evictTerminalRunsForBytesInOp(requiredBytes: number): Promise<void> {
    while (this.retainedBytes + requiredBytes > this.maxRetainedBytes && this.terminalRuns.length > 0) {
      await this.evictRunInOp(this.terminalRuns.shift() as RunId)
    }
  }

  private async evictTerminalRunsToCountInOp(): Promise<void> {
    while (this.terminalRuns.length > this.maxRetainedRuns) {
      await this.evictRunInOp(this.terminalRuns.shift() as RunId)
    }
  }

  private async evictRunInOp(runId: RunId): Promise<void> {
    const run = this.runs.get(runId) as MutableRun
    const snapshot: RunSnapshot = {
      id: run.id,
      status: run.status,
      taskIds: [...run.taskIds],
      createdAt: run.createdAt,
      ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt }),
    }
    await this.commit({ type: 'run/evicted', run: snapshot })
    for (const taskId of run.taskIds) {
      const task = this.tasks.get(taskId) as MutableTask
      this.retainedBytes -= task.retainedBytes
      this.tasks.delete(taskId)
    }
    this.runs.delete(runId)
    this.emit({ type: 'run/evicted', run: snapshot })
  }

  private buildTask(runId: RunId, spec: NormalizedTaskSpec, retainedBytes: number): MutableTask {
    return {
      id: spec.id,
      runId,
      label: spec.label,
      dependencies: [...spec.dependencies],
      executor: spec.executor,
      ...(spec.input === undefined ? {} : { input: spec.input }),
      ...(spec.parentId === undefined ? {} : { parentId: spec.parentId }),
      status: spec.dependencies.length === 0 ? 'ready' : 'pending',
      createdAt: Date.now(),
      cancelRequested: false,
      cancelReason: 'cancelled by caller',
      retainedBytes,
    }
  }

  private specOf(task: MutableTask): NormalizedTaskSpec {
    return {
      id: task.id,
      label: task.label,
      dependencies: [...task.dependencies],
      executor: task.executor,
      ...(task.input === undefined ? {} : { input: task.input }),
      ...(task.parentId === undefined ? {} : { parentId: task.parentId }),
    }
  }

  // A replayed snapshot carries exactly the fields specOf persisted, so the
  // declaration is the same projection applied to the durable shape.
  private declarationOf(task: TaskSnapshot): NormalizedTaskSpec {
    return this.specOf(task as MutableTask)
  }

  private snapshotRun(run: MutableRun): RunSnapshot {
    return {
      id: run.id,
      status: run.status,
      taskIds: [...run.taskIds],
      createdAt: run.createdAt,
      ...(run.finishedAt === undefined ? {} : { finishedAt: run.finishedAt }),
    }
  }

  private snapshotTask(task: MutableTask): TaskSnapshot {
    return {
      id: task.id,
      runId: task.runId,
      label: task.label,
      dependencies: [...task.dependencies],
      executor: task.executor,
      // `input` is a required `unknown` member: absent is not representable,
      // undefined is a legal value, so it is detached unconditionally.
      input: detachValue(task.input, 'task input'),
      ...(task.parentId === undefined ? {} : { parentId: task.parentId }),
      status: task.status,
      ...(task.output === undefined ? {} : { output: detachValue(task.output, 'task output') }),
      ...(task.error === undefined ? {} : { error: task.error }),
      createdAt: task.createdAt,
      ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }),
      ...(task.finishedAt === undefined ? {} : { finishedAt: task.finishedAt }),
    }
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

  private notify<T>(listener: (value: T) => unknown, value: T): void {
    try {
      void Promise.resolve(listener(value)).catch((error: unknown) => {
        this.ctx.logger.warn(`coordination listener rejected: ${String(error)}`)
      })
    } catch (error: unknown) {
      this.ctx.logger.warn(`coordination listener rejected: ${String(error)}`)
    }
  }

  private emit(event: CoordinationEvent): void {
    // Per-listener detach: one listener mutating its copy must not leak into
    // the copies other listeners receive.
    for (const listener of this.events) this.notify(listener, detachValue(event, 'coordination event'))
  }

  /**
   * Stop accepting work, cancel everything in flight through the journaled
   * path, wait for executor continuations to settle, drain the op chain, and
   * release the journal unit. Cordis awaits this disposer, so a disposal
   * caller observes full quiescence.
   */
  private async dispose(): Promise<void> {
    this.disposed = true
    this.events.clear()
    this.messages.clear()
    this.approvals.clear()
    const disposalError = new CoordinationError('coordination service disposed', 'INVALID_TRANSITION')
    for (const pending of [...this.pendingApprovals.values()]) pending.reject(disposalError)
    this.pendingApprovals.clear()
    for (const run of this.runs.values()) run.cancelRequested = true
    await this.enqueue(async () => {
      for (const task of [...this.tasks.values()]) await this.cancelTaskInOp(task, 'coordination service disposed')
      for (const run of [...this.runs.values()]) await this.updateRunInOp(run)
    })
    while (this.executions.size > 0) await Promise.allSettled([...this.executions])
    await this.ops
    this.executors.clear()
    this.tasks.clear()
    this.runs.clear()
    this.terminalRuns.length = 0
    this.retainedBytes = 0
    this.active = 0
    await this.unit?.close()
    this.unit = undefined
  }
}

export default SqliteCoordinationService
