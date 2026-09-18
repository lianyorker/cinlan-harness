# Work Items

[English](work-items.md) | 中文

## 组合

[Work Items 包族](../../packages/work-items/README.zh.md) 将标准化读取和持久化写入与固定地址的 GitHub/Linear Provider 分离。[可选 bundle](../../packages/bundle/cinlan-work-items/README.zh.md) 为基于 base 的 Web profile 增加模型工具及 Web Remote/UI。

## 读取与本地关联

WorkItem 包含带 Provider 前缀的不透明 id、来源、标题、状态、HTTPS URL、标签、负责人及可选正文/时间戳。WorkItemPage 保留 Provider 游标和截断标记。选择时必须指定来源，或恰好只有一个可用 Provider；不可用或有歧义的配置会明确失败。

[controller](../../packages/api/work-items-controller/README.zh.md) 持久化显式 WorkItem/Workspace/Session 元组。已删除的 Workspace、已归档或不属于该 Workspace 的 Session 不能接收新关联。目标不可用时隐藏已有链接；删除并重建 Workspace 不复用旧身份。取消关联无需连接 Provider 即可清理过期本地记录。

## 写入状态

注册表持有不可变 WorkItemMutation 预览，并以 WorkItemWriteId 标识。Provider 写入默认关闭。启用后仍需独立的 prepareWrite 和 confirmWrite 调用；确认时重新检查范围及目标版本。回执跨顺序 Host 重启保留。

| 状态 | 含义 |
|---|---|
| prepared | 已校验预览，等待确认 |
| running | 已持久化发送标记；恢复时视为不确定 |
| succeeded | 已确认 Provider 回执 |
| failed | 已拒绝或尚未发送 |
| unknown | 外部操作可能已生效；绝不自动重发 |
| canceled | 未执行的预览已取消 |
| expired | 确认前预览有效期已结束 |

## 限制

[服务](../../packages/work-items/work-items/README.zh.md) 定义边界值、错误和持久化写入语义。[Settings UI](../../packages/client/ui-work-items/README.zh.md) 展示已有工单与显式本地关联，不创建 Session 或 worktree。凭据保留在 Host。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
