/** Saved SSH targets with revisioned persistence and generation-owned remote inspection. */
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-execution-host'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ZodType } from 'zod'
import { Config } from './config.ts'
import { SshTargetConnection } from './connection.ts'
import { ExecutionTargetError } from './errors.ts'
import {
  createTargetSchema, executionTargetsDomain, inspectDirectorySchema,
  targetRequestSchema, targetRevisionSchema, updateTargetSchema,
} from './spec.ts'
import type {
  CreateTargetRequest, ExecutionTargetId, InspectDirectoryRequest, InspectionValue, ListTargetsValue,
  SavedTarget, TargetRequest, TargetRevisionRequest, TargetState, TargetValue, TargetView, UpdateTargetRequest,
} from './types.ts'

export { ExecutionTargetError } from './errors.ts'
export type * from './types.ts'
export type { Config } from './config.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { executionHostTargets: ExecutionHostTargets }
  interface Events {
    /**
     * Saved records or one live connection observation changed after its commit.
     * @mode emit
     */
    'execution-host-targets/changed'(): void
  }
}

interface LiveTarget {
  readonly generation: number
  readonly connection: SshTargetConnection
}

function parse<T>(schema: ZodType<T>, request: unknown): T {
  const result = schema.safeParse(request)
  if (!result.success) throw new ExecutionTargetError('invalid-request', 'Invalid execution target request')
  return result.data
}

/** Concrete saved-target registry and OpenSSH connector for the management UI. */
export default class ExecutionHostTargets extends Service {
  static inject = ['storageDomain', 'subprocess', 'executionHost']
  static Config = Config
  private table: KvTable<ExecutionTargetId, SavedTarget> | undefined
  private readonly live = new Map<ExecutionTargetId, LiveTarget>()
  private readonly states = new Map<ExecutionTargetId, TargetState>()
  private readonly operations = new Set<Promise<unknown>>()
  private mutations: Promise<void> = Promise.resolve()
  private generation = 0
  private closed = false

  constructor(ctx: Context, private readonly config: Config) {
    if (config.operationTimeoutMs + 2 * config.shutdownTimeoutMs > 2147483647) {
      throw new RangeError('Inspection timeout plus two shutdown deadlines exceeds the Node timer limit')
    }
    super(ctx, 'executionHostTargets')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(executionTargetsDomain)
    this.table = domain.table('targets')
    for (const [key, record] of this.table.entries()) {
      if (key !== record.id) { await domain.close(); throw new Error('execution target record identity does not match its key') }
    }
    this.ctx.effect(() => async () => {
      this.closed = true
      try {
        const closures = await Promise.allSettled([...this.live.values()].map(value => value.connection.close()))
        await Promise.allSettled([...this.operations])
        await this.mutations
        const failures = closures.filter(value => value.status === 'rejected').map(value => value.reason as unknown)
        if (failures.length > 0) throw new AggregateError(failures, 'Execution target SSH process cleanup failed')
      } finally {
        this.live.clear()
        this.states.clear()
        await domain.close()
      }
    }, 'execution targets connections and storage')
  }

  /**
   * Read saved targets with current local process provenance and transient observations.
   * @returns the complete management snapshot.
   */
  list(): ListTargetsValue {
    return { targets: [...this.requireTable().entries()].map(([, record]) => this.view(record)), current: this.ctx.executionHost.current() }
  }

  /**
   * Save an OpenSSH alias; credential values remain outside this domain.
   * @param request User-provided label and concrete alias.
   * @returns the durable target, initially disconnected.
   */
  create(request: CreateTargetRequest): Promise<TargetValue> {
    const value = parse(createTargetSchema, request)
    return this.mutate(async () => {
      const table = this.requireTable()
      if (table.size >= this.config.maxTargets) throw new ExecutionTargetError('limit-reached', 'Saved execution target limit reached')
      const now = new Date().toISOString()
      const record: SavedTarget = { ...value, id: randomUUID() as ExecutionTargetId, revision: 1, createdAt: now, updatedAt: now }
      await table.put(record.id, record)
      this.changed()
      return { target: this.view(record) }
    })
  }

  /**
   * Disconnect before atomically replacing editable metadata at its current revision.
   * @param request Exact saved revision and replacement label/alias.
   * @returns the durable replacement record.
   */
  update(request: UpdateTargetRequest): Promise<TargetValue> {
    const value = parse(updateTargetSchema, request)
    return this.mutate(async () => {
      const current = this.requireRevision(value)
      await this.disconnectCurrent(value.id)
      const next = {
        ...current, label: value.label, sshAlias: value.sshAlias, revision: current.revision + 1, updatedAt: new Date().toISOString(),
      }
      await this.requireTable().put(value.id, next)
      this.changed()
      return { target: this.view(next) }
    })
  }

  /**
   * Remove a saved target after its active operations have settled.
   * @param request Exact saved revision to remove.
   * @returns acknowledgement after durable deletion.
   */
  remove(request: TargetRevisionRequest): Promise<Record<string, never>> {
    const value = parse(targetRevisionSchema, request)
    return this.mutate(async () => {
      this.requireRevision(value)
      await this.disconnectCurrent(value.id)
      await this.requireTable().delete(value.id)
      this.states.delete(value.id)
      this.changed()
      return {}
    })
  }

  /**
   * Authenticate, negotiate and perform an actual exported-root inspection before publishing readiness.
   * @param request Exact saved revision used to connect.
   * @param signal Cancellation before connection publication.
   * @returns a generation-bound ready target or a typed operational refusal.
   */
  connect(request: TargetRevisionRequest, signal?: AbortSignal): Promise<TargetValue> {
    const value = parse(targetRevisionSchema, request)
    return this.track(this.connectOperation(value, signal))
  }

  private async connectOperation(request: TargetRevisionRequest, signal?: AbortSignal): Promise<TargetValue> {
    const { record, live } = await this.mutate(async () => {
      signal?.throwIfAborted()
      const record = this.requireRevision(request)
      await this.disconnectCurrent(record.id)
      this.requireTable()
      signal?.throwIfAborted()
      const generation = ++this.generation
      const connection = new SshTargetConnection(this.ctx.subprocess, this.config, record.sshAlias, (cleanup) => {
        void this.track(cleanup.catch((error: unknown) => { this.ctx.logger.error('Execution target SSH cleanup failed', error) }))
        if (this.live.get(record.id)?.generation !== generation || this.closed) return
        this.states.set(record.id, { phase: 'error', generation, code: 'connection-lost', message: 'Target connection was lost; reconnect to inspect' })
        this.changed()
      })
      const live = { generation, connection }
      this.live.set(record.id, live)
      this.states.set(record.id, { phase: 'connecting', generation })
      this.changed()
      return { record, live }
    })
    try {
      this.requireTable()
      signal?.throwIfAborted()
      const info = await live.connection.open(signal)
      const first = info.roots[0]
      if (first === undefined) {
        throw new ExecutionTargetError('roots-unconfigured', 'Configure exported roots in the target execution-host profile before connecting')
      }
      await live.connection.inspect(first.id, '', signal)
      if (this.live.get(record.id) !== live || this.closed || !live.connection.isUsable()
        || this.states.get(record.id)?.phase !== 'connecting') {
        throw new ExecutionTargetError('cancelled', 'Target connection was superseded')
      }
      this.states.set(record.id, { phase: 'ready', generation: live.generation, info, checkedAt: new Date().toISOString() })
      this.changed()
      return { target: this.view(this.requireRecord(record.id)) }
    } catch (error) {
      await live.connection.close()
      const failure = error instanceof ExecutionTargetError
        ? error : signal?.aborted === true
          ? new ExecutionTargetError('cancelled', 'Execution target connection was cancelled', { cause: error })
          : new ExecutionTargetError('unreachable', 'Execution target connection failed', { cause: error })
      if (this.live.get(record.id) === live && !this.closed) {
        this.live.delete(record.id)
        this.states.set(record.id, { phase: 'error', generation: live.generation, code: failure.code, message: failure.message })
        this.changed()
      }
      throw failure
    }
  }

  /**
   * Disconnect and await remote inspection cancellation acknowledgement.
   * @param request Exact saved target.
   * @returns the disconnected saved target.
   */
  disconnect(request: TargetRequest): Promise<TargetValue> {
    const value = parse(targetRequestSchema, request)
    return this.mutate(async () => {
      const record = this.requireRecord(value.id)
      await this.disconnectCurrent(value.id)
      return { target: this.view(record) }
    })
  }

  /**
   * Inspect only an advertised remote root on the supplied connection generation.
   * @param request Target, generation and worker-owned relative path.
   * @param signal Cancellation propagated to the remote operation.
   * @returns target provenance and the bounded remote directory result.
   */
  inspectDirectory(request: InspectDirectoryRequest, signal?: AbortSignal): Promise<InspectionValue> {
    const value = parse(inspectDirectorySchema, request)
    this.requireRecord(value.id)
    const live = this.live.get(value.id)
    const state = this.states.get(value.id)
    if (live === undefined || state?.phase !== 'ready' || live.generation !== value.generation || !live.connection.isUsable()) {
      return Promise.reject(new ExecutionTargetError('connection-lost', 'Target connection changed; reconnect and select its current root'))
    }
    if (!state.info.roots.some(root => root.id === value.rootId)) {
      return Promise.reject(new ExecutionTargetError('invalid-request', 'The target does not export this root'))
    }
    return this.track((async () => {
      const inspection = await live.connection.inspect(value.rootId, value.path, signal)
      if (this.live.get(value.id) !== live || this.closed || !live.connection.isUsable()
        || this.states.get(value.id)?.phase !== 'ready') {
        throw new ExecutionTargetError('connection-lost', 'Inspection belongs to an expired connection')
      }
      this.states.set(value.id, { ...state, checkedAt: new Date().toISOString() })
      this.changed()
      return { inspection, target: this.view(this.requireRecord(value.id)) }
    })())
  }

  private async disconnectCurrent(id: ExecutionTargetId): Promise<void> {
    const live = this.live.get(id)
    if (live !== undefined) {
      this.states.set(id, { phase: 'disconnected' })
      this.changed()
      let confirmed: boolean
      try { confirmed = await live.connection.close() }
      catch (cause) {
        const error = new ExecutionTargetError('connection-lost', 'Local SSH process cleanup could not be confirmed', { cause })
        this.states.set(id, { phase: 'error', generation: live.generation, code: error.code, message: error.message })
        this.changed()
        throw error
      }
      this.live.delete(id)
      if (!confirmed) {
        const error = new ExecutionTargetError('outcome-unconfirmed', 'Target did not confirm all inspection outcomes before disconnecting')
        this.states.set(id, { phase: 'error', generation: live.generation, code: error.code, message: error.message })
        this.changed()
        throw error
      }
    }
    this.states.set(id, { phase: 'disconnected' })
    this.changed()
  }

  private view(record: SavedTarget): TargetView {
    return { ...record, state: this.states.get(record.id) ?? { phase: 'disconnected' } }
  }

  private requireTable(): KvTable<ExecutionTargetId, SavedTarget> {
    if (this.closed || this.table === undefined) throw new ExecutionTargetError('closed', 'Execution target registry is unavailable')
    return this.table
  }

  private requireRecord(id: ExecutionTargetId): SavedTarget {
    const record = this.requireTable().get(id)
    if (record === undefined) throw new ExecutionTargetError('not-found', 'Saved execution target was not found')
    return record
  }

  private requireRevision(request: TargetRevisionRequest): SavedTarget {
    const record = this.requireRecord(request.id)
    if (record.revision !== request.revision) throw new ExecutionTargetError('conflict', 'Saved target changed; refresh before applying this action')
    return record
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(() => { this.requireTable(); return operation() })
    this.mutations = result.then(() => {}, () => {})
    return result
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation)
    void operation.then(() => { this.operations.delete(operation) }, () => { this.operations.delete(operation) })
    return operation
  }

  private changed(): void {
    if (!this.closed) this.ctx.emit('execution-host-targets/changed')
  }
}
