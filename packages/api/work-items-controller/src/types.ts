/** Browser-safe Work Items commands and durable association projections. */
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

import type { WorkItemMutation, WorkItemWriteId, WorkItemWriteOperation, WorkItemSource, WorkItem, WorkItemId, WorkItemListRequest, WorkItemsErrorCode } from '@deepseek-ai/dsh-work-items/types'
export type { WorkItemId, WorkItemSource } from '@deepseek-ai/dsh-work-items/types'

/** One explicitly saved association; branch status is derived from the current lease. */
export interface WorkItemAssociation {
  readonly workspaceId: WorkspaceId
  readonly workspaceTitle: string
  readonly sessionId?: SessionId
  readonly branch?: string
  readonly phase?: 'active' | 'hibernated'
}
/** A provider item with local associations, never a guessed association. */
export interface WorkItemView extends WorkItem { readonly associations: readonly WorkItemAssociation[] }
/** Read-only provider filters plus optional local association projection scope. */
export interface WorkItemsListRequest extends WorkItemListRequest { readonly workspaceId?: WorkspaceId }
/** One page with provider cursor preserved. */
export interface WorkItemsListValue {
  readonly items: readonly WorkItemView[]
  readonly nextCursor?: string
  readonly truncated: boolean
}
/** One provider item, optionally scoped to a local Workspace's association. */
export interface WorkItemsGetRequest { readonly id: WorkItemId; readonly workspaceId?: WorkspaceId }
/** Persist or remove one association. This does not mutate the external issue. */
export interface WorkItemsAssociationRequest {
  readonly id: WorkItemId
  readonly workspaceId: WorkspaceId
  readonly sessionId?: SessionId
}
/** Association receipt published only after the local write succeeds. */
export interface WorkItemsAssociationValue { readonly associations: readonly WorkItemAssociation[] }

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Classified provider failure, without credentials or response bodies. */
    'work-items/operation-failed': { readonly providerCode: WorkItemsErrorCode }
    /** Association targets a foreign or archived Session. */
    'work-items/invalid-association': { readonly workspaceId: WorkspaceId; readonly sessionId?: SessionId }
  }
}

/** Proposed external mutation, presented before any side effect is allowed. */
export interface WorkItemsPrepareWriteRequest { readonly mutation: WorkItemMutation }
/** Confirmation/cancellation identifies a stored immutable preview, never a replacement payload. */
export interface WorkItemsWriteRequest { readonly operationId: WorkItemWriteId }
/** Bounded provider-specific history query. */
export interface WorkItemsWriteHistoryRequest { readonly source: WorkItemSource; readonly limit: number }
/** Public write operation receipt. */
export interface WorkItemsWriteValue { readonly operation: WorkItemWriteOperation }
/** Durable write history includes pending approvals and uncertain effects. */
export interface WorkItemsWriteHistoryValue { readonly operations: readonly WorkItemWriteOperation[] }
export type { WorkItemMutation, WorkItemWriteId, WorkItemWriteOperation } from '@deepseek-ai/dsh-work-items/types'
