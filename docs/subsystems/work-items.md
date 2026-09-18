# Work Items

English | [中文](work-items.zh.md)

## Composition

The [Work Items family](../../packages/work-items/README.md) separates normalized reads and durable writes from fixed-origin GitHub/Linear providers. Its [optional bundle](../../packages/bundle/cinlan-work-items/README.md) adds model tools and the Web Remote/UI to a base-backed Web profile.

## Reads and local associations

WorkItem contains an opaque provider-prefixed id, source, title, state, HTTPS URL, labels, assignees, and optional body/timestamps. WorkItemPage retains the provider cursor and truncation flag. Selection requires an explicit source or exactly one usable provider; unavailable or ambiguous configurations fail explicitly.

The [controller](../../packages/api/work-items-controller/README.md) persists explicit WorkItem/Workspace/Session tuples. Deleted Workspaces and archived or foreign Sessions cannot receive new links. Existing links are hidden when their target is unavailable; deleting and recreating a Workspace does not reuse its old identity. Unlink can remove stale local records without contacting the provider.

## Write states

The registry owns immutable WorkItemMutation previews identified by WorkItemWriteId. Provider writes are disabled by default. Enabled writes require separate prepareWrite and confirmWrite calls; confirmation rechecks scope and target revision. Receipts are retained through sequential Host restarts.

| Status | Meaning |
|---|---|
| prepared | Validated preview awaiting confirmation |
| running | Durable dispatch marker; recovery treats this as uncertain |
| succeeded | Confirmed provider receipt |
| failed | Rejected or not dispatched |
| unknown | Possible external effect; never automatically resent |
| canceled | Unexecuted preview canceled |
| expired | Preview lifetime elapsed before confirmation |

## Limits

The [service](../../packages/work-items/work-items/README.md) owns bounds, errors, and durable-write semantics. The [Settings UI](../../packages/client/ui-work-items/README.md) shows existing issues and explicit local links; it does not create Sessions or worktrees. Credentials stay on the Host.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxworkitems--workitemsruntime"></a>

### `ctx.workItems` — `WorkItemsRuntime`

Registry and dispatch facade for Work Items providers.

```ts cordis-catalog
/**
 * Register one provider for the calling plugin lifetime.
 * @param provider - provider implementation with a stable id.
 * @returns disposer for this exact provider contribution.
 */
registerProvider(provider: WorkItemsProvider): () => void

/**
 * Validate and persist an exact external-write preview without executing it.
 * @param mutation - Proposed source mutation; strings are bounded and stored verbatim.
 * @param signal - Cancellation before preview publication.
 * @returns Durable operation requiring a separate confirmation.
 */
prepareWrite(mutation: WorkItemMutation, signal?: AbortSignal): Promise<WorkItemWriteOperation>

/**
 * Confirm exactly one stored preview; terminal receipts are replayed without repeating the mutation.
 * @param operationId - Identity returned by prepareWrite; callers cannot replace its payload.
 * @param signal - Cancellation; post-dispatch cancellation may leave an unknown outcome.
 * @returns Durable receipt; unknown outcomes must be checked at the provider, never automatically retried.
 */
confirmWrite(operationId: WorkItemWriteId, signal?: AbortSignal): Promise<WorkItemWriteOperation>

/**
 * Cancel an unconfirmed operation without contacting the provider.
 * @param operationId - Existing durable operation.
 * @returns Canceled or already-terminal receipt.
 */
cancelWrite(operationId: WorkItemWriteId): Promise<WorkItemWriteOperation>

/**
 * Read recent durable write receipts, including interrupted operations after restart.
 * @param source - Provider family to inspect.
 * @param limit - Explicit maximum result count from 1 through 100.
 * @returns Newest-first bounded operation history.
 */
listWrites(source: WorkItemSource, limit: number): Promise<readonly WorkItemWriteOperation[]>

/**
 * List normalized Work Items through the selected provider.
 * @param request - bounded provider-neutral filters and cursor.
 * @param signal - optional cancellation signal.
 * @returns a bounded normalized page.
 */
async list(request: WorkItemListRequest = {}, signal?: AbortSignal): Promise<WorkItemPage>

/**
 * Read one normalized Work Item through the selected provider.
 * @param request - opaque item identity.
 * @param signal - optional cancellation signal.
 * @returns the normalized item.
 */
async get(request: WorkItemGetRequest, signal?: AbortSignal): Promise<WorkItem>
```

Source: [`packages/work-items/work-items/src/index.ts`](../../packages/work-items/work-items/src/index.ts)

<a id="ctxworkitemscontroller--workitemscontroller"></a>

### `ctx.workItemsController` — `WorkItemsController`

Host API serving external items, local links, and explicit write approvals.

```ts cordis-catalog
/**
 * List one provider page without activating Sessions or changing external items.
 * @param request - Provider filters and optional association scope.
 * @param signal - Caller cancellation.
 * @returns normalized page with explicitly stored local links.
 */
@Remote('list') async list(request: WorkItemsListRequest, signal: AbortSignal): Promise<WorkItemsListValue>

/**
 * Read one issue and its local associations.
 * @param request - Exact issue id and optional Workspace.
 * @param signal - Caller cancellation.
 * @returns provider item and validated local links.
 */
@Remote('get') async get(request: WorkItemsGetRequest, signal: AbortSignal): Promise<WorkItemView>

/**
 * Save one explicit association after verifying the item and Workspace ownership.
 * @param request - Work Item, Workspace and optional owned Session.
 * @param signal - Cancellation before the durable write is admitted.
 * @returns associations after durability; duplicate commands are idempotent.
 */
@Remote('associate') async associate(request: WorkItemsAssociationRequest, signal: AbortSignal): Promise<WorkItemsAssociationValue>

/**
 * Remove an exact local link even when the provider or target is unavailable.
 * @param request - Association identity to remove.
 * @param signal - Cancellation before write admission.
 * @returns the remaining valid links after durability.
 */
@Remote('disassociate') async disassociate(request: WorkItemsAssociationRequest, signal: AbortSignal): Promise<WorkItemsAssociationValue>

/**
 * Prepare an immutable external-write preview without dispatching it.
 * @param request - Proposed mutation fields.
 * @param signal - Cancellation before preview persistence.
 * @returns Durable operation requiring separate confirmation.
 */
@Remote('prepareWrite') async prepareWrite(request: WorkItemsPrepareWriteRequest, signal: AbortSignal): Promise<WorkItemsWriteValue>

/**
 * Confirm exactly the stored preview and replay prior receipts without another mutation.
 * @param request - Preview identity approved by the user.
 * @param signal - Cancellation; post-dispatch effects can become unknown.
 * @returns Durable execution receipt.
 */
@Remote('confirmWrite') async confirmWrite(request: WorkItemsWriteRequest, signal: AbortSignal): Promise<WorkItemsWriteValue>

/**
 * Cancel an unconfirmed preview; dispatched operations retain their receipts.
 * @param request - Stored preview identity.
 * @param signal - Cancellation before accessing the write ledger.
 * @returns Canceled or existing terminal operation.
 */
@Remote('cancelWrite') async cancelWrite(request: WorkItemsWriteRequest, signal: AbortSignal): Promise<WorkItemsWriteValue>

/**
 * Read bounded durable mutation history without provider I/O.
 * @param request - Provider family and explicit row limit.
 * @param signal - Cancellation before reading the durable history.
 * @returns Newest-first previews and receipts.
 */
@Remote('listWrites') async listWrites(request: WorkItemsWriteHistoryRequest, signal: AbortSignal): Promise<WorkItemsWriteHistoryValue>
```

Source: [`packages/api/work-items-controller/src/index.ts`](../../packages/api/work-items-controller/src/index.ts)
<!-- END GENERATED cordis-surface -->
