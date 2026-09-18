/**
 * Provider-neutral Work Items reads and confirmed writes (ctx.workItems).
 * Providers own HTTP, credentials, pagination, and source-specific mapping;
 * this registry owns selection, lifecycle, and the normalized reads and durable write approval protocol.
 * @module @deepseek-ai/dsh-work-items
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { WorkItemsError } from './error.ts'
import { WorkItemsWriteLedger } from './writes.ts'
import type { WorkItemMutation, WorkItemWriteId, WorkItemWriteOperation } from './types.ts'
export { WorkItemsError } from './error.ts'
import type { WorkItem, WorkItemGetRequest, WorkItemListRequest, WorkItemPage, WorkItemsProvider } from './types.ts'
import type { WorkItemId, WorkItemSource } from './types.ts'

export type * from './types.ts'


declare module '@deepseek-ai/cordis' {
  interface Context { workItems: WorkItemsRuntime }
}

/** Service configuration selecting a provider by source. */
export interface Config {
  /** Explicit provider id; omitted selects exactly one usable provider. */
  readonly provider?: WorkItemSource
  /** Milliseconds before an unconfirmed write preview expires. */
  readonly writeApprovalTtlMs?: number
}

const CONFIG_KEYS = new Set(['provider', 'writeApprovalTtlMs'])

function resolveConfig(config: Config): Config {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error("work-items: unsupported config key '" + key + "'")
  }
  if (config.provider !== undefined && !['github', 'gitlab', 'linear'].includes(config.provider)) {
    throw new Error('work-items: provider must be github, gitlab, or linear')
  }
  if (config.writeApprovalTtlMs !== undefined && (!Number.isSafeInteger(config.writeApprovalTtlMs) || config.writeApprovalTtlMs < 1)) {
    throw new Error('work-items: writeApprovalTtlMs must be a positive safe integer')
  }
  return config
}

/**
 * Brand a validated provider item id at the service boundary.
 * @param value - Non-empty provider item identity.
 * @returns The branded Work Item id.
 */
export function WorkItemId(value: string): WorkItemId {
  if (value.length === 0 || value.length > 500 || value.trim() !== value) throw new TypeError('work item id must be non-empty, trimmed, and at most 500 characters')
  return value as WorkItemId
}


const MAX_WORK_ITEMS = 100
const MAX_WORK_ITEM_TEXT = 20_000
const MAX_WORK_ITEM_ID = 500
const MAX_WORK_ITEM_CURSOR = 500

function providerRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WorkItemsError('invalid-response', 'Work Items provider returned an invalid ' + field)
  }
  return value as Record<string, unknown>
}

function providerText(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > MAX_WORK_ITEM_TEXT || (!allowEmpty && value.length === 0)) {
    throw new WorkItemsError('invalid-response', 'Work Items provider returned an invalid ' + field)
  }
  return value
}

function providerOptionalText(value: unknown, field: string, allowEmpty = false): string | undefined {
  return value === undefined ? undefined : providerText(value, field, allowEmpty)
}

function providerTimestamp(value: unknown, field: string): string | undefined {
  const timestamp = providerOptionalText(value, field)
  if (timestamp !== undefined && Number.isNaN(Date.parse(timestamp))) {
    throw new WorkItemsError('invalid-response', 'Work Items provider returned an invalid ' + field)
  }
  return timestamp
}

function providerStrings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_WORK_ITEMS) {
    throw new WorkItemsError('invalid-response', 'Work Items provider returned invalid ' + field)
  }
  return value.map(entry => providerText(entry, field.slice(0, -1)))
}

function providerItem(value: unknown, source: WorkItemSource): WorkItem {
  const item = providerRecord(value, 'item')
  const rawId = providerText(item.id, 'item id')
  if (rawId.length > MAX_WORK_ITEM_ID || rawId.trim() !== rawId || !rawId.startsWith(source + ':')) {
    throw new WorkItemsError('invalid-response', 'Work Items provider returned an invalid item id')
  }
  if (item.source !== source) throw new WorkItemsError('invalid-response', 'Work Items provider returned the wrong source')
  const url = providerText(item.url, 'item URL')
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('unsafe')
  } catch (error) {
    throw new WorkItemsError('invalid-response', 'Work Items provider returned an invalid item URL', { cause: error })
  }
  const key = providerOptionalText(item.key, 'item key')
  const body = providerOptionalText(item.body, 'item body', true)
  const repository = providerOptionalText(item.repository, 'item repository')
  const createdAt = providerTimestamp(item.createdAt, 'item creation time')
  const updatedAt = providerTimestamp(item.updatedAt, 'item update time')
  return {
    id: WorkItemId(rawId),
    source,
    externalId: providerText(item.externalId, 'external id'),
    ...(key === undefined ? {} : { key }),
    title: providerText(item.title, 'item title'),
    ...(body === undefined ? {} : { body }),
    state: providerText(item.state, 'item state'),
    url,
    ...(repository === undefined ? {} : { repository }),
    labels: providerStrings(item.labels, 'labels'),
    assignees: providerStrings(item.assignees, 'assignees'),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  }
}

function providerPage(value: unknown, source: WorkItemSource): WorkItemPage {
  const page = providerRecord(value, 'page')
  if (!Array.isArray(page.items) || page.items.length > MAX_WORK_ITEMS || typeof page.truncated !== 'boolean') {
    throw new WorkItemsError('invalid-response', 'Work Items provider returned an invalid page')
  }
  const nextCursor = page.nextCursor === undefined
    ? undefined
    : providerText(page.nextCursor, 'pagination cursor')
  if (nextCursor !== undefined && nextCursor.length > MAX_WORK_ITEM_CURSOR) {
    throw new WorkItemsError('invalid-response', 'Work Items provider returned an invalid pagination cursor')
  }
  return {
    items: page.items.map(item => providerItem(item, source)),
    ...(nextCursor === undefined ? {} : { nextCursor }),
    truncated: page.truncated,
  }
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new WorkItemsError('aborted', 'Work Items request was cancelled', { cause: signal.reason })
  }
}

/** Registry and dispatch facade for Work Items providers. */
export class WorkItemsRuntime extends Service {
  static Config: z<Config> = z.object({
    provider: z.union(['github', 'linear', 'gitlab'] as const),
    writeApprovalTtlMs: z.number().step(1).min(1).default(300_000),
  })
  private readonly writeLedger: WorkItemsWriteLedger
  private readonly providers = new Map<WorkItemSource, WorkItemsProvider>()
  private readonly providerId: WorkItemSource | undefined

  /**
   * @param ctx - Cordis context owning the Work Items service.
   * @param config - optional explicit provider selection.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'workItems')
    this.providerId = resolveConfig(config).provider
    this.writeLedger = new WorkItemsWriteLedger(ctx, source => this.active(source),
      (request, signal) => this.get(request, signal), config.writeApprovalTtlMs ?? 300_000)
  }

  /**
   * Register one provider for the calling plugin lifetime.
   * @param provider - provider implementation with a stable id.
   * @returns disposer for this exact provider contribution.
   */
  registerProvider(provider: WorkItemsProvider): () => void {
    if (!['github', 'linear', 'gitlab'].includes(provider.id)) throw new WorkItemsError('invalid-request', 'Work Items provider id must be github, linear, or gitlab')
    if (this.providers.has(provider.id)) throw new WorkItemsError('invalid-request', 'Work Items provider ' + provider.id + ' is already registered')
    const dispose = this.ctx.effect(function* (this: WorkItemsRuntime) {
      this.providers.set(provider.id, provider)
      yield () => {
        this.providers.delete(provider.id)
        provider.dispose?.()
      }
    }.bind(this), 'workItems.registerProvider()')
    return () => { void dispose() }
  }

  /**
   * Validate and persist an exact external-write preview without executing it.
   * @param mutation - Proposed source mutation; strings are bounded and stored verbatim.
   * @param signal - Cancellation before preview publication.
   * @returns Durable operation requiring a separate confirmation.
   */
  prepareWrite(mutation: WorkItemMutation, signal?: AbortSignal): Promise<WorkItemWriteOperation> {
    return this.writeLedger.prepare(mutation, signal)
  }

  /**
   * Confirm exactly one stored preview; terminal receipts are replayed without repeating the mutation.
   * @param operationId - Identity returned by prepareWrite; callers cannot replace its payload.
   * @param signal - Cancellation; post-dispatch cancellation may leave an unknown outcome.
   * @returns Durable receipt; unknown outcomes must be checked at the provider, never automatically retried.
   */
  confirmWrite(operationId: WorkItemWriteId, signal?: AbortSignal): Promise<WorkItemWriteOperation> {
    return this.writeLedger.confirm(operationId, signal)
  }

  /**
   * Cancel an unconfirmed operation without contacting the provider.
   * @param operationId - Existing durable operation.
   * @returns Canceled or already-terminal receipt.
   */
  cancelWrite(operationId: WorkItemWriteId): Promise<WorkItemWriteOperation> {
    return this.writeLedger.cancel(operationId)
  }

  /**
   * Read recent durable write receipts, including interrupted operations after restart.
   * @param source - Provider family to inspect.
   * @param limit - Explicit maximum result count from 1 through 100.
   * @returns Newest-first bounded operation history.
   */
  listWrites(source: WorkItemSource, limit: number): Promise<readonly WorkItemWriteOperation[]> {
    return this.writeLedger.list(source, limit)
  }

  private active(source?: WorkItemSource): WorkItemsProvider {
    if (this.providerId !== undefined && source !== undefined && this.providerId !== source) {
      throw new WorkItemsError('invalid-request', 'requested Work Items source conflicts with configured provider')
    }
    const selectedId = this.providerId ?? source
    if (selectedId !== undefined) {
      const provider = this.providers.get(selectedId)
      if (provider === undefined) throw new WorkItemsError('configured-missing', 'configured Work Items provider ' + selectedId + ' is not registered')
      if (!provider.available()) throw new WorkItemsError('configured-unavailable', 'configured Work Items provider ' + selectedId + ' is unavailable')
      return provider
    }
    const usable = [...this.providers.values()].filter(provider => provider.available())
    const [only] = usable
    if (only === undefined) throw new WorkItemsError('unavailable', 'no usable Work Items provider is registered')
    if (usable.length > 1) throw new WorkItemsError('ambiguous', 'multiple usable Work Items providers are registered (' + usable.map(provider => provider.id).join(', ') + ')')
    return only
  }

  /**
   * List normalized Work Items through the selected provider.
   * @param request - bounded provider-neutral filters and cursor.
   * @param signal - optional cancellation signal.
   * @returns a bounded normalized page.
   */
  async list(request: WorkItemListRequest = {}, signal?: AbortSignal): Promise<WorkItemPage> {
    assertNotAborted(signal)
    const provider = this.active(request.source ?? request.scope?.source)
    const page = await provider.list(request, signal)
    assertNotAborted(signal)
    return providerPage(page, provider.id)
  }

  /**
   * Read one normalized Work Item through the selected provider.
   * @param request - opaque item identity.
   * @param signal - optional cancellation signal.
   * @returns the normalized item.
   */
  async get(request: WorkItemGetRequest, signal?: AbortSignal): Promise<WorkItem> {
    const source = request.id.startsWith('github:') ? 'github' : request.id.startsWith('linear:') ? 'linear' : request.id.startsWith('gitlab:') ? 'gitlab' : undefined
    if (source === undefined) throw new WorkItemsError('invalid-request', 'Work Item id has no supported provider prefix')
    assertNotAborted(signal)
    const item = await this.active(source).get(request, signal)
    assertNotAborted(signal)
    const normalized = providerItem(item, source)
    if (normalized.id !== request.id) throw new WorkItemsError('invalid-response', 'Work Items provider returned a different item')
    return normalized
  }
}

export default WorkItemsRuntime
