/** Provider-neutral Work Items reads, approved mutations, and durable receipts. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identity of one provider item. */
export type WorkItemId = Branded<'WorkItemId'>

/** Provider families supported by the Work Items service. */
export type WorkItemSource = 'github' | 'linear' | 'gitlab' | 'jira'

/** State filter understood by every provider. */
export type WorkItemStateFilter = 'open' | 'closed' | 'all'

/** A structured provider scope; requests never carry an arbitrary URL. */
export type WorkItemScope =
  | { readonly source: 'github'; readonly owner: string; readonly repository: string }
  | { readonly source: 'linear'; readonly team?: string; readonly project?: string }
  | { readonly source: 'gitlab'; readonly owner: string; readonly repository: string }
  | { readonly source: 'jira'; readonly project: string }

/** One normalized issue or task returned by a provider. */
export interface WorkItem {
  readonly id: WorkItemId
  readonly source: WorkItemSource
  readonly externalId: string
  readonly key?: string
  readonly title: string
  readonly body?: string
  readonly state: string
  readonly url: string
  readonly repository?: string
  readonly labels: readonly string[]
  readonly assignees: readonly string[]
  readonly createdAt?: string
  readonly updatedAt?: string
  /** Provider comment history when the source exposes it; omitted otherwise. */
  readonly comments?: readonly WorkItemComment[]
  /** Attachment metadata when the source exposes a structured list; binaries are never fetched. */
  readonly attachments?: readonly WorkItemAttachment[]
  /** Iteration the item belongs to — sprint, cycle, or milestone in provider terms. */
  readonly iteration?: WorkItemIteration
  /** Priority label as the provider reports it; omitted when the source has no priority field. */
  readonly priority?: string
  /** Due date as the provider reports it — ISO date or timestamp; omitted when the source has none. */
  readonly dueAt?: string
  /** Effort estimate in the provider's native unit; omitted when the source reports none. */
  readonly estimate?: WorkItemEstimate
  /** Parent item id in this provider's id space; omitted when the item has no parent or the source cannot express it. */
  readonly parentId?: WorkItemId
  /** Typed relations to other items in this provider's id space; omitted when the source has no link surface. */
  readonly links?: readonly WorkItemLink[]
}

/** Normalized effort estimate; each provider fills only the slot matching its native unit. */
export interface WorkItemEstimate {
  /** Story points, as reported by point-based trackers like Linear. */
  readonly points?: number
  /** Seconds, as reported by time-based trackers like Jira and GitLab. */
  readonly seconds?: number
}

/** One typed relation from a Work Item to another provider item. */
export interface WorkItemLink {
  /** Relation label as the provider reports it — 'blocks', 'relates_to', 'duplicate', and similar. */
  readonly type: string
  /** Related item id in the reporting provider's id space. */
  readonly itemId: WorkItemId
}

/** One normalized iteration assignment on a provider item. */
export interface WorkItemIteration {
  readonly title: string
  readonly state?: string
  readonly startsAt?: string
  readonly endsAt?: string
}

/** One normalized comment on a provider item. */
export interface WorkItemComment {
  readonly author?: string
  readonly body: string
  readonly createdAt?: string
  readonly updatedAt?: string
}

/** One attachment listed by a provider; only metadata and link survive normalization. */
export interface WorkItemAttachment {
  readonly name?: string
  readonly url: string
  readonly size?: number
  readonly mimeType?: string
  readonly createdAt?: string
}

/** Bounded read request for a provider list operation. */
export interface WorkItemListRequest {
  readonly source?: WorkItemSource
  readonly scope?: WorkItemScope
  readonly query?: string
  readonly state?: WorkItemStateFilter
  readonly cursor?: string
  readonly limit?: number
}

/** Read request for one opaque item identity. */
export interface WorkItemGetRequest {
  readonly id: WorkItemId
}

/** A bounded page of normalized Work Items. */
export interface WorkItemPage {
  readonly items: readonly WorkItem[]
  readonly nextCursor?: string
  readonly truncated: boolean
}

/** One board column; each entry carries the ids of the items assigned to it. */
export interface WorkItemBoardColumn {
  readonly title: string
  readonly itemIds: readonly WorkItemId[]
}

/** One normalized board: ordered columns with bounded item ids. */
export interface WorkItemBoard {
  readonly id: string
  readonly title: string
  readonly url?: string
  readonly columns: readonly WorkItemBoardColumn[]
}

/** Bounded read request for the boards of a provider scope. */
export interface WorkItemBoardRequest {
  readonly source?: WorkItemSource
  /** Provider board id or title selecting one board when the scope exposes several. */
  readonly board?: string
  /** Maximum item ids retained per column, provider-bounded. */
  readonly limit?: number
}

/** Provider implementation for one Work Items source. */
export interface WorkItemsProvider {
  /** Provider family registered with the Work Items service. */
  readonly id: WorkItemSource
  /** Cheap local check that must not perform network or credential I/O. */
  available(): boolean
  /** List bounded items in the provider's configured scope. */
  list(request: WorkItemListRequest, signal?: AbortSignal): Promise<WorkItemPage>
  /** Read one item identified by this provider's opaque WorkItemId. */
  get(request: WorkItemGetRequest, signal?: AbortSignal): Promise<WorkItem>
  /** Optional board read for the configured scope; providers without a native board surface omit it. */
  boards?(request: WorkItemBoardRequest, signal?: AbortSignal): Promise<WorkItemBoard[]>
  /** Optional explicitly enabled write capability; this is a trusted Provider implementation, not an approval API. */
  readonly writer?: WorkItemsWriter
  /** Release provider-owned resources. */
  dispose?(): void
}

/** Provider-neutral failure categories used by Host/API Consumers. */
export type WorkItemsErrorCode =
  | 'unavailable'
  | 'configured-missing'
  | 'configured-unavailable'
  | 'ambiguous'
  | 'authentication-required'
  | 'forbidden'
  | 'not-found'
  | 'rate-limited'
  | 'invalid-response'
  | 'provider-failed'
  | 'invalid-request'
  | 'aborted'
  | 'write-disabled'
  | 'write-conflict'
  | 'write-not-found'
  | 'write-rejected'

/** Opaque durable identity of one previewed external mutation. */
export type WorkItemWriteId = Branded<'WorkItemWriteId'>

/** External mutations supported by the first-party write adapters. */
export type WorkItemMutation =
  | { readonly kind: 'create'; readonly source: WorkItemSource; readonly title: string; readonly body: string }
  | { readonly kind: 'comment'; readonly id: WorkItemId; readonly body: string }
  | { readonly kind: 'state'; readonly id: WorkItemId; readonly state: string }
  | { readonly kind: 'assign'; readonly id: WorkItemId; readonly assignees: readonly string[] }

/** Result identity returned by a successful external mutation; no raw provider response is retained. */
export interface WorkItemMutationResult {
  readonly itemId: WorkItemId
  readonly url: string
}

/** Trusted Provider write adapter; consumer operations use the durable approval API instead. */
export interface WorkItemsWriter {
  /** Exact configured scope, including write-relevant policy; changes invalidate an outstanding approval. */
  readonly scope: string
  /** Read and validate prerequisites without mutating external state. */
  validate(this: void, mutation: WorkItemMutation, signal?: AbortSignal): Promise<void>
  /** Issue at most one mutation; never retry a request whose outcome is uncertain. */
  execute(this: void, mutation: WorkItemMutation, signal?: AbortSignal): Promise<WorkItemMutationResult>
}

/** Durable write state. Unknown includes interrupted or ambiguous post-dispatch outcomes and is never replayed. */
export type WorkItemWriteStatus = 'prepared' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'canceled' | 'expired'

/** Immutable approval preview and its durable execution receipt. */
export interface WorkItemWriteOperation {
  readonly operationId: WorkItemWriteId
  readonly source: WorkItemSource
  readonly scope: string
  readonly mutation: WorkItemMutation
  readonly status: WorkItemWriteStatus
  readonly createdAt: number
  readonly expiresAt: number
  readonly target?: { readonly id: WorkItemId; readonly title: string; readonly updatedAt?: string }
  readonly result?: WorkItemMutationResult
  readonly errorCode?: WorkItemsErrorCode
}
