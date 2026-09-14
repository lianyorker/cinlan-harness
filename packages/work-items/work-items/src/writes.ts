/** Durable two-step approval and at-most-once dispatch for external Work Item mutations. */
import { createHash, randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { WorkItemsError } from './error.ts'
import { mutationSchema, workItemWriteDomain, type WriteRecord } from './write-domain.ts'
import type {
  WorkItem, WorkItemGetRequest, WorkItemMutation, WorkItemsErrorCode, WorkItemsProvider,
  WorkItemSource, WorkItemWriteId, WorkItemWriteOperation, WorkItemMutationResult,
} from './types.ts'

const revisionOf = (item: WorkItem): string => createHash('sha256').update(JSON.stringify(item)).digest('hex')
const view = ({ revision: _revision, ...record }: WriteRecord): WorkItemWriteOperation => structuredClone(record)
const classified = (error: unknown): WorkItemsErrorCode => error instanceof WorkItemsError ? error.code : 'provider-failed'
const rejected = new Set<WorkItemsErrorCode>(['authentication-required', 'forbidden', 'not-found', 'rate-limited', 'write-rejected', 'invalid-request', 'write-disabled'])

/** Owns serialized mutation admission, persistence, execution, and quiescent disposal. */
export class WorkItemsWriteLedger {
  private table?: KvTable<WorkItemWriteId, WriteRecord>
  private closeDomain?: () => Promise<void>
  private tail: Promise<void> = Promise.resolve()
  private closing = false
  private readonly lifetime = new AbortController()

  /**
   * @param ctx - Owner context; storageDomain is required only when a write operation is used.
   * @param provider - Resolves the current provider rather than retaining one across reloads.
   * @param read - Public normalized read used for exact identity and revision checks.
   * @param ttl - Lifetime of a preview before separate user confirmation.
   */
  constructor(
    private readonly ctx: Context,
    private readonly provider: (source: WorkItemSource) => WorkItemsProvider,
    private readonly read: (request: WorkItemGetRequest, signal?: AbortSignal) => Promise<WorkItem>,
    private readonly ttl: number,
  ) {
    ctx.effect(() => async () => {
      this.closing = true
      this.lifetime.abort()
      await this.tail
      await this.closeDomain?.()
    }, 'work-items: write ledger')
  }

  /**
   * Persist a validated preview; no external mutation is issued.
   * @param mutation - Exact proposed action.
   * @param signal - Caller cancellation.
   * @returns Prepared immutable preview.
   */
  prepare(mutation: WorkItemMutation, signal?: AbortSignal): Promise<WorkItemWriteOperation> {
    const parsed = mutationSchema.safeParse(mutation)
    if (!parsed.success) return Promise.reject(new WorkItemsError('invalid-request', 'Invalid Work Items mutation'))
    const request = parsed.data
    return this.enqueue(async (table) => {
      const combined = this.signal(signal)
      combined.throwIfAborted()
      const source = request.kind === 'create' ? request.source : this.sourceOf(request.id)
      const provider = this.provider(source)
      const writer = provider.writer
      if (writer === undefined) throw new WorkItemsError('write-disabled', 'Work Items writes are disabled')
      await writer.validate(request, combined)
      const target = request.kind === 'create' ? undefined : await this.read({ id: request.id }, combined)
      combined.throwIfAborted()
      const record: WriteRecord = {
        operationId: randomUUID() as WorkItemWriteId, source, scope: writer.scope, mutation: request,
        status: 'prepared', createdAt: Date.now(), expiresAt: Date.now() + this.ttl,
        ...(target === undefined ? {} : {
          target: { id: target.id, title: target.title, ...(target.updatedAt === undefined ? {} : { updatedAt: target.updatedAt }) },
          revision: revisionOf(target),
        }),
      }
      await table.put(record.operationId, record)
      return view(record)
    })
  }

  /**
   * Execute one stored approval; retries return its existing receipt.
   * @param operationId - Approved operation id, never a replaceable payload.
   * @param signal - Caller cancellation.
   * @returns The committed terminal receipt or a prior terminal/uncertain state.
   */
  confirm(operationId: WorkItemWriteId, signal?: AbortSignal): Promise<WorkItemWriteOperation> {
    return this.enqueue(async (table) => {
      const record = this.record(table, operationId)
      if (record.status !== 'prepared') return view(record)
      if (record.expiresAt <= Date.now()) return this.save(table, { ...record, status: 'expired' })
      const combined = this.signal(signal)
      let dispatched = false
      let result: WorkItemMutationResult
      try {
        combined.throwIfAborted()
        const writer = this.provider(record.source).writer
        if (writer === undefined) throw new WorkItemsError('write-disabled', 'Work Items writes are disabled')
        if (writer.scope !== record.scope) throw new WorkItemsError('write-conflict', 'Provider scope changed; prepare a new approval')
        await writer.validate(record.mutation, combined)
        if (record.mutation.kind !== 'create') {
          const current = await this.read({ id: record.mutation.id }, combined)
          if (revisionOf(current) !== record.revision) throw new WorkItemsError('write-conflict', 'Work Item changed; prepare a new approval')
        }
        combined.throwIfAborted()
        await table.put(operationId, { ...record, status: 'running' })
        // The running marker precedes the network effect. Its recovery is unknown, never another dispatch.
        combined.throwIfAborted()
        dispatched = true
        result = await writer.execute(record.mutation, combined)
        const url = new URL(result.url)
        if (!result.itemId.startsWith(record.source + ':') || url.protocol !== 'https:' || url.username || url.password
          || (record.mutation.kind !== 'create' && result.itemId !== record.mutation.id)) {
          throw new WorkItemsError('invalid-response', 'Provider returned an invalid mutation receipt')
        }
      } catch (error) {
        const code = combined.aborted ? 'aborted' : classified(error)
        const status = dispatched && !rejected.has(code) ? 'unknown' : 'failed'
        return this.save(table, { ...record, status, errorCode: code })
      }
      return this.save(table, { ...record, status: 'succeeded', result })
    })
  }

  /**
   * Cancel an outstanding approval; never erase a dispatched operation.
   * @param operationId - Exact stored identity.
   * @returns Canceled or prior receipt.
   */
  cancel(operationId: WorkItemWriteId): Promise<WorkItemWriteOperation> {
    return this.enqueue(async (table) => {
      const record = this.record(table, operationId)
      return record.status === 'prepared' ? this.save(table, { ...record, status: 'canceled' }) : view(record)
    })
  }

  /**
   * Read bounded durable receipts without enabling or contacting a provider.
   * @param source - Provider family.
   * @param limit - Result count from 1 to 100.
   * @returns Newest-first receipt history.
   */
  list(source: WorkItemSource, limit: number): Promise<readonly WorkItemWriteOperation[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      return Promise.reject(new WorkItemsError('invalid-request', 'Write history limit must be between 1 and 100'))
    }
    return this.enqueue(table => Promise.resolve([...table.entries()].map(([, value]) => value)
      .filter(value => value.source === source).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map(view)))
  }

  private sourceOf(id: string): WorkItemSource {
    if (id.startsWith('github:')) return 'github'
    if (id.startsWith('linear:')) return 'linear'
    if (id.startsWith('gitlab:')) return 'gitlab'
    throw new WorkItemsError('invalid-request', 'Unknown Work Item source')
  }

  private signal(signal?: AbortSignal): AbortSignal {
    return signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal])
  }

  private record(table: KvTable<WorkItemWriteId, WriteRecord>, id: WorkItemWriteId): WriteRecord {
    const record = table.get(id)
    if (record === undefined) throw new WorkItemsError('write-not-found', 'Write approval not found')
    return record
  }

  private async save(table: KvTable<WorkItemWriteId, WriteRecord>, record: WriteRecord): Promise<WorkItemWriteOperation> {
    await table.put(record.operationId, record)
    return view(record)
  }

  private enqueue<T>(action: (table: KvTable<WorkItemWriteId, WriteRecord>) => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new WorkItemsError('unavailable', 'Work Items service is closing'))
    const result = this.tail.then(async () => {
      if (this.closing) throw new WorkItemsError('unavailable', 'Work Items service is closing')
      if (this.table === undefined) {
        const storage = this.ctx.get('storageDomain')
        if (storage === undefined) throw new WorkItemsError('configured-missing', 'Durable storage is required for Work Items writes')
        const domain = await storage.open(workItemWriteDomain)
        this.closeDomain = () => domain.close()
        this.table = domain.table('operations')
        for (const [id, record] of this.table.entries()) {
          if (record.status === 'running') await this.table.put(id, { ...record, status: 'unknown', errorCode: 'provider-failed' })
        }
      }
      return action(this.table)
    })
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
}
