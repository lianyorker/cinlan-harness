/** Work Items Remote reads, local associations, and durable external-write approvals. */
import { Context, Service } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { WorkItemsError } from '@deepseek-ai/dsh-work-items'
import type { WorkItem, WorkItemId } from '@deepseek-ai/dsh-work-items/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-workspace-isolation'
import { associationKey, workItemAssociations } from './associations.ts'
import type { AssociationKey, AssociationRecord } from './associations.ts'
import type {
  WorkItemsPrepareWriteRequest, WorkItemsWriteRequest, WorkItemsWriteValue, WorkItemsWriteHistoryRequest, WorkItemsWriteHistoryValue,
  WorkItemAssociation, WorkItemView, WorkItemsAssociationRequest, WorkItemsAssociationValue,
  WorkItemsGetRequest, WorkItemsListRequest, WorkItemsListValue,
} from './types.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { workItemsController: WorkItemsController }
}

/** Host API serving external items, local links, and explicit write approvals. */
export class WorkItemsController extends TypertRemoteService {
  static inject = ['typert', 'workItems', 'workspaceRegistry', 'storageDomain']
  private links?: KvTable<AssociationKey, AssociationRecord>
  private writes: Promise<unknown> = Promise.resolve()
  private disposed = false

  /** @param ctx - Host services for items, metadata and durable associations. */
  constructor(ctx: Context) { super(ctx, 'workItemsController', { namespace: 'workItems' }) }

  /** Open the association domain before admitting any Remote command. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(workItemAssociations)
    this.links = domain.table('links')
    this.ctx.effect(() => async () => {
      this.disposed = true
      await this.writes
      await domain.close()
    }, 'work-items-controller.associations')
  }

  /**
   * List one provider page without activating Sessions or changing external items.
   * @param request - Provider filters and optional association scope.
   * @param signal - Caller cancellation.
   * @returns normalized page with explicitly stored local links.
   */
  @Remote('list')
  async list(request: WorkItemsListRequest, signal: AbortSignal): Promise<WorkItemsListValue> {
    if (request.workspaceId !== undefined) this.requireWorkspace(request.workspaceId)
    const page = await this.readProvider(() => this.ctx.workItems.list(request, signal))
    return { ...page, items: page.items.map(item => this.view(item, request.workspaceId)) }
  }

  /**
   * Read one issue and its local associations.
   * @param request - Exact issue id and optional Workspace.
   * @param signal - Caller cancellation.
   * @returns provider item and validated local links.
   */
  @Remote('get')
  async get(request: WorkItemsGetRequest, signal: AbortSignal): Promise<WorkItemView> {
    if (request.workspaceId !== undefined) this.requireWorkspace(request.workspaceId)
    const item = await this.readProvider(() => this.ctx.workItems.get({ id: request.id }, signal))
    return this.view(item, request.workspaceId)
  }

  /**
   * Save one explicit association after verifying the item and Workspace ownership.
   * @param request - Work Item, Workspace and optional owned Session.
   * @param signal - Cancellation before the durable write is admitted.
   * @returns associations after durability; duplicate commands are idempotent.
   */
  @Remote('associate')
  async associate(request: WorkItemsAssociationRequest, signal: AbortSignal): Promise<WorkItemsAssociationValue> {
    this.requireAssociation(request)
    await this.readProvider(() => this.ctx.workItems.get({ id: request.id }, signal))
    return await this.enqueue(async () => {
      signal.throwIfAborted()
      this.requireAssociation(request)
      const key = associationKey(request)
      const table = this.table()
      if (table.get(key) === undefined) await table.put(key, { ...request })
      return { associations: this.associations(request.id) }
    })
  }

  /**
   * Remove an exact local link even when the provider or target is unavailable.
   * @param request - Association identity to remove.
   * @param signal - Cancellation before write admission.
   * @returns the remaining valid links after durability.
   */
  @Remote('disassociate')
  async disassociate(request: WorkItemsAssociationRequest, signal: AbortSignal): Promise<WorkItemsAssociationValue> {
    return await this.enqueue(async () => {
      signal.throwIfAborted()
      const table = this.table()
      const key = associationKey(request)
      if (table.get(key) !== undefined) await table.delete(key)
      return { associations: this.associations(request.id) }
    })
  }

  /**
   * Prepare an immutable external-write preview without dispatching it.
   * @param request - Proposed mutation fields.
   * @param signal - Cancellation before preview persistence.
   * @returns Durable operation requiring separate confirmation.
   */
  @Remote('prepareWrite')
  async prepareWrite(request: WorkItemsPrepareWriteRequest, signal: AbortSignal): Promise<WorkItemsWriteValue> {
    return { operation: await this.readProvider(() => this.ctx.workItems.prepareWrite(request.mutation, signal)) }
  }

  /**
   * Confirm exactly the stored preview and replay prior receipts without another mutation.
   * @param request - Preview identity approved by the user.
   * @param signal - Cancellation; post-dispatch effects can become unknown.
   * @returns Durable execution receipt.
   */
  @Remote('confirmWrite')
  async confirmWrite(request: WorkItemsWriteRequest, signal: AbortSignal): Promise<WorkItemsWriteValue> {
    return { operation: await this.readProvider(() => this.ctx.workItems.confirmWrite(request.operationId, signal)) }
  }

  /**
   * Cancel an unconfirmed preview; dispatched operations retain their receipts.
   * @param request - Stored preview identity.
   * @param signal - Cancellation before accessing the write ledger.
   * @returns Canceled or existing terminal operation.
   */
  @Remote('cancelWrite')
  async cancelWrite(request: WorkItemsWriteRequest, signal: AbortSignal): Promise<WorkItemsWriteValue> {
    signal.throwIfAborted()
    return { operation: await this.readProvider(() => this.ctx.workItems.cancelWrite(request.operationId)) }
  }

  /**
   * Read bounded durable mutation history without provider I/O.
   * @param request - Provider family and explicit row limit.
   * @param signal - Cancellation before reading the durable history.
   * @returns Newest-first previews and receipts.
   */
  @Remote('listWrites')
  async listWrites(request: WorkItemsWriteHistoryRequest, signal: AbortSignal): Promise<WorkItemsWriteHistoryValue> {
    signal.throwIfAborted()
    return { operations: await this.readProvider(() => this.ctx.workItems.listWrites(request.source, request.limit)) }
  }

  private requireWorkspace(id: WorkspaceId) {
    const workspace = this.ctx.workspaceRegistry.get(id)
    if (workspace === undefined) throw new RemoteError('workspace/not-found', 'Workspace not found', { workspaceId: id })
    return workspace
  }

  private requireAssociation(request: WorkItemsAssociationRequest): void {
    const workspace = this.requireWorkspace(request.workspaceId)
    if (request.sessionId !== undefined && (!workspace.sessionIds.includes(request.sessionId)
      || this.ctx.workspaceRegistry.archivedSessionIds.includes(request.sessionId))) {
      throw new RemoteError('work-items/invalid-association', 'Session must be unarchived and belong to the Workspace', {
        workspaceId: request.workspaceId, sessionId: request.sessionId,
      })
    }
  }

  private associations(id: WorkItemId, workspaceId?: WorkspaceId): WorkItemAssociation[] {
    const values: WorkItemAssociation[] = []
    for (const [, record] of this.table().entries()) {
      if (record.id !== id || (workspaceId !== undefined && record.workspaceId !== workspaceId)) continue
      const workspace = this.ctx.workspaceRegistry.get(record.workspaceId)
      if (workspace === undefined) continue
      if (record.sessionId !== undefined && (!workspace.sessionIds.includes(record.sessionId)
        || this.ctx.workspaceRegistry.archivedSessionIds.includes(record.sessionId))) continue
      const lease = record.sessionId === undefined ? undefined : this.ctx.get('workspaceIsolation')?.find(record.sessionId)
      const matching = lease?.sourcePath === workspace.path ? lease : undefined
      values.push({
        workspaceId: workspace.id, workspaceTitle: workspace.title,
        ...(record.sessionId === undefined ? {} : { sessionId: record.sessionId }),
        ...(matching === undefined ? {} : { branch: matching.branch, phase: matching.phase }),
      })
    }
    return values
  }

  private view(item: WorkItem, workspaceId?: WorkspaceId): WorkItemView {
    return { ...item, associations: this.associations(item.id, workspaceId) }
  }

  private table(): KvTable<AssociationKey, AssociationRecord> {
    if (this.links === undefined || this.disposed) throw new Error('Work Items association storage is not ready')
    return this.links
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Work Items controller is disposed'))
    const result = this.writes.then(operation)
    this.writes = result.then(() => undefined, () => undefined)
    return result
  }

  private async readProvider<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() } catch (error) {
      if (!(error instanceof WorkItemsError)) throw error
      throw new RemoteError('work-items/operation-failed', error.message, { providerCode: error.code })
    }
  }
}
export default WorkItemsController
