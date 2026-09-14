/** Model-facing Work Items reads and durable external-write approval tools. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { WorkItemId } from '@deepseek-ai/dsh-work-items'
import type {} from '@deepseek-ai/dsh-work-items'
import type {
  WorkItem,
  WorkItemListRequest,
  WorkItemMutation,
  WorkItemPage,
  WorkItemId as WorkItemIdType,
  WorkItemScope,
  WorkItemSource,
  WorkItemWriteId,
  WorkItemWriteOperation,
} from '@deepseek-ai/dsh-work-items/types'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Cordis plugin name. */
export const name = 'tool-work-items'

/** Services required by the model-facing Work Items Consumer. */
export const inject = ['systemPrompt', 'tools', 'workItems']

/** Stable guidance for provider-neutral Work Items reads and approved writes. */
export const WORK_ITEMS_SYSTEM_PROMPT = 'Use work_items_list or work_items_get for Work Items reads. External changes use two steps: call work_items_prepare_write to persist an immutable preview, inspect its operation_id and mutation, and call work_items_confirm_write with exactly that operation_id only after the requested approval. work_items_confirm_write and work_items_cancel_write never accept replacement mutation fields. A running or unknown result may have reached the provider; do not retry it automatically. Use work_items_list_writes or the provider UI to verify uncertain outcomes. Provider scope is deployment-configured; never invent an endpoint, header, token, or GraphQL text.'

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TEXT_LENGTH = 20_000
const MAX_SCOPE_LENGTH = 500
const MAX_LIMIT = 100

/** Tool configuration. */
export interface Config {
  /** Cooperative timeout attached to every Work Items tool call. */
  readonly timeoutMs?: number
}

/** Loader schema for the Work Items tool configuration. */
export const Config: z<Config> = z.object({
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(DEFAULT_TIMEOUT_MS),
})

interface ResolvedConfig {
  readonly timeoutMs: number
}

const CONFIG_KEYS = new Set(['timeoutMs'])

const GITHUB_SCOPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { type: 'string', const: 'github', required: true },
    owner: { type: 'string', required: true, description: 'Configured GitHub repository owner.' },
    repository: { type: 'string', required: true, description: 'Configured GitHub repository name.' },
  },
} as const

const LINEAR_SCOPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { type: 'string', const: 'linear', required: true },
    team: { type: 'string', description: 'Configured Linear team id.' },
    project: { type: 'string', description: 'Configured Linear project id.' },
  },
} as const

const GITLAB_SCOPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { type: 'string', const: 'gitlab', required: true },
    owner: { type: 'string', required: true, description: 'Configured GitLab namespace.' },
    repository: { type: 'string', required: true, description: 'Configured GitLab project path.' },
  },
} as const

const SCOPE_SCHEMA = { oneOf: [GITHUB_SCOPE_SCHEMA, LINEAR_SCOPE_SCHEMA, GITLAB_SCOPE_SCHEMA] } as const

const ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    source: { type: 'string', required: true, enum: ['github', 'linear', 'gitlab'] },
    externalId: { type: 'string', required: true },
    key: { type: 'string' },
    title: { type: 'string', required: true },
    body: { type: 'string' },
    state: { type: 'string', required: true },
    url: { type: 'string', required: true },
    repository: { type: 'string' },
    labels: { type: 'array', required: true, items: { type: 'string' } },
    assignees: { type: 'array', required: true, items: { type: 'string' } },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const

const PAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: { type: 'array', required: true, items: ITEM_SCHEMA },
    nextCursor: { type: 'string' },
    truncated: { type: 'boolean', required: true },
  },
} as const

const MUTATION_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'create', required: true },
        source: { type: 'string', required: true, enum: ['github', 'linear', 'gitlab'] },
        title: { type: 'string', required: true, description: 'New Work Item title.' },
        body: { type: 'string', required: true, description: 'New Work Item body.' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'comment', required: true },
        id: { type: 'string', required: true, description: 'Opaque id returned by a Work Items read.' },
        body: { type: 'string', required: true, description: 'Comment body.' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'state', required: true },
        id: { type: 'string', required: true, description: 'Opaque id returned by a Work Items read.' },
        state: { type: 'string', required: true, description: 'Provider state value.' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', const: 'assign', required: true },
        id: { type: 'string', required: true, description: 'Opaque id returned by a Work Items read.' },
        assignees: { type: 'array', required: true, items: { type: 'string' }, description: 'Provider assignee ids; an empty list clears assignment.' },
      },
    },
  ],
} as const

const OPERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    operationId: { type: 'string', required: true },
    source: { type: 'string', required: true, enum: ['github', 'linear', 'gitlab'] },
    mutation: { ...MUTATION_SCHEMA, required: true },
    status: {
      type: 'string',
      required: true,
      enum: ['prepared', 'running', 'succeeded', 'failed', 'unknown', 'canceled', 'expired'],
    },
    createdAt: { type: 'integer', required: true },
    expiresAt: { type: 'integer', required: true },
    target: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true },
        title: { type: 'string', required: true },
        updatedAt: { type: 'string' },
      },
    },
    result: {
      type: 'object',
      additionalProperties: false,
      properties: {
        itemId: { type: 'string', required: true },
        url: { type: 'string', required: true },
      },
    },
    errorCode: {
      type: 'string',
      enum: [
        'unavailable', 'configured-missing', 'configured-unavailable', 'ambiguous',
        'authentication-required', 'forbidden', 'not-found', 'rate-limited',
        'invalid-response', 'provider-failed', 'invalid-request', 'aborted',
        'write-disabled', 'write-conflict', 'write-not-found', 'write-rejected',
      ],
    },
  },
} as const

const SOURCE_SCHEMA = { type: 'string', required: true, enum: ['github', 'linear', 'gitlab'] } as const

function resolveConfig(config: Config): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`tool-work-items: unsupported config key '${key}'`)
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-work-items: timeoutMs must be a positive safe integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  return { timeoutMs }
}

function boundedText(value: string, field: string, allowEmpty = true): string {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH || (!allowEmpty && value.trim().length === 0)) {
    throw new Error(`${field} must be a string of at most ${MAX_TEXT_LENGTH} characters${allowEmpty ? '' : ' and must not be blank'}`)
  }
  return value
}

function nonEmpty(value: string, field: string, maximum = MAX_SCOPE_LENGTH): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value.trim() !== value) {
    throw new Error(`${field} must be non-empty, trimmed, and at most ${maximum} characters`)
  }
  return value
}

function source(value: string): WorkItemSource {
  if (value !== 'github' && value !== 'linear' && value !== 'gitlab') throw new Error('source must be github, linear, or gitlab')
  return value
}

function itemId(value: string): WorkItemIdType {
  const id = nonEmpty(value, 'id')
  if (!id.startsWith('github:') && !id.startsWith('linear:') && !id.startsWith('gitlab:')) throw new Error('id must start with github:, linear:, or gitlab:')
  return WorkItemId(id)
}

function operationId(value: string): WorkItemWriteId {
  return nonEmpty(value, 'operation_id') as WorkItemWriteId
}

function positiveLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new Error(`limit must be a positive safe integer no greater than ${MAX_LIMIT}`)
  }
  return value
}

type ModelScope =
  | { readonly source: 'github'; readonly owner: string; readonly repository: string }
  | { readonly source: 'linear'; readonly team?: string; readonly project?: string }
  | { readonly source: 'gitlab'; readonly owner: string; readonly repository: string }

type ModelMutation =
  | { readonly kind: 'create'; readonly source: WorkItemSource; readonly title: string; readonly body: string }
  | { readonly kind: 'comment'; readonly id: string; readonly body: string }
  | { readonly kind: 'state'; readonly id: string; readonly state: string }
  | { readonly kind: 'assign'; readonly id: string; readonly assignees: readonly string[] }

function normalizeScope(value: ModelScope): WorkItemScope {
  if (value.source === 'github') {
    return {
      source: 'github',
      owner: nonEmpty(value.owner, 'scope.owner'),
      repository: nonEmpty(value.repository, 'scope.repository'),
    }
  }
  if (value.source === 'gitlab') {
    return {
      source: 'gitlab',
      owner: nonEmpty(value.owner, 'scope.owner'),
      repository: nonEmpty(value.repository, 'scope.repository'),
    }
  }
  const team = value.team === undefined ? undefined : nonEmpty(value.team, 'scope.team')
  const project = value.project === undefined ? undefined : nonEmpty(value.project, 'scope.project')
  if (team === undefined && project === undefined) throw new Error('scope.team or scope.project is required for a Linear scope')
  return {
    source: 'linear',
    ...(team === undefined ? {} : { team }),
    ...(project === undefined ? {} : { project }),
  }
}

function listRequest(args: {
  readonly source?: WorkItemSource
  readonly scope?: ModelScope
  readonly query?: string
  readonly state?: 'open' | 'closed' | 'all'
  readonly cursor?: string
  readonly limit?: number
}): WorkItemListRequest {
  const scope = args.scope === undefined ? undefined : normalizeScope(args.scope)
  if (scope !== undefined && args.source !== undefined && args.source !== scope.source) {
    throw new Error('source must match scope.source')
  }
  const query = args.query === undefined ? undefined : boundedText(args.query, 'query')
  const cursor = args.cursor === undefined ? undefined : nonEmpty(args.cursor, 'cursor')
  const limit = args.limit === undefined ? undefined : positiveLimit(args.limit)
  return {
    ...(args.source === undefined ? {} : { source: source(args.source) }),
    ...(scope === undefined ? {} : { scope }),
    ...(query === undefined ? {} : { query }),
    ...(args.state === undefined ? {} : { state: args.state }),
    ...(cursor === undefined ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit }),
  }
}

function normalizeMutation(value: ModelMutation): WorkItemMutation {
  switch (value.kind) {
    case 'create':
      return {
        kind: 'create',
        source: source(value.source),
        title: nonEmpty(value.title, 'title'),
        body: boundedText(value.body, 'body'),
      }
    case 'comment':
      return { kind: 'comment', id: itemId(value.id), body: boundedText(value.body, 'body', false) }
    case 'state':
      return { kind: 'state', id: itemId(value.id), state: nonEmpty(value.state, 'state') }
    case 'assign': {
      if (value.assignees.length > 10) throw new Error('assignees must contain at most 10 entries')
      return {
        kind: 'assign',
        id: itemId(value.id),
        assignees: value.assignees.map((entry, index) => nonEmpty(entry, `assignees[${index}]`)),
      }
    }
    default:
      throw new Error('unsupported Work Items mutation')
  }
}

interface PublicItem {
  readonly id: string
  readonly source: WorkItemSource
  readonly externalId: string
  readonly key?: string
  readonly title: string
  readonly body?: string
  readonly state: string
  readonly url: string
  readonly repository?: string
  readonly labels: string[]
  readonly assignees: string[]
  readonly createdAt?: string
  readonly updatedAt?: string
}

function itemValue(item: WorkItem): PublicItem {
  return {
    id: item.id,
    source: item.source,
    externalId: item.externalId,
    ...(item.key === undefined ? {} : { key: item.key }),
    title: item.title,
    ...(item.body === undefined ? {} : { body: item.body }),
    state: item.state,
    url: item.url,
    ...(item.repository === undefined ? {} : { repository: item.repository }),
    labels: [...item.labels],
    assignees: [...item.assignees],
    ...(item.createdAt === undefined ? {} : { createdAt: item.createdAt }),
    ...(item.updatedAt === undefined ? {} : { updatedAt: item.updatedAt }),
  }
}

interface PublicPage {
  readonly items: PublicItem[]
  readonly nextCursor?: string
  readonly truncated: boolean
}

function pageValue(page: WorkItemPage): PublicPage {
  return {
    items: page.items.map(itemValue),
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    truncated: page.truncated,
  }
}

type PublicMutation =
  | { readonly kind: 'create'; readonly source: WorkItemSource; readonly title: string; readonly body: string }
  | { readonly kind: 'comment'; readonly id: string; readonly body: string }
  | { readonly kind: 'state'; readonly id: string; readonly state: string }
  | { readonly kind: 'assign'; readonly id: string; readonly assignees: string[] }

function mutationValue(mutation: WorkItemMutation): PublicMutation {
  switch (mutation.kind) {
    case 'create': return { kind: 'create', source: mutation.source, title: mutation.title, body: mutation.body }
    case 'comment': return { kind: 'comment', id: mutation.id, body: mutation.body }
    case 'state': return { kind: 'state', id: mutation.id, state: mutation.state }
    case 'assign': return { kind: 'assign', id: mutation.id, assignees: [...mutation.assignees] }
    default: throw new Error('unsupported stored Work Items mutation')
  }
}

interface PublicOperation {
  readonly operationId: string
  readonly source: WorkItemSource
  readonly mutation: PublicMutation
  readonly status: WorkItemWriteOperation['status']
  readonly createdAt: number
  readonly expiresAt: number
  readonly target?: { readonly id: string; readonly title: string; readonly updatedAt?: string }
  readonly result?: { readonly itemId: string; readonly url: string }
  readonly errorCode?: NonNullable<WorkItemWriteOperation['errorCode']>
}

function operationValue(operation: WorkItemWriteOperation): PublicOperation {
  return {
    operationId: operation.operationId,
    source: operation.source,
    mutation: mutationValue(operation.mutation),
    status: operation.status,
    createdAt: operation.createdAt,
    expiresAt: operation.expiresAt,
    ...(operation.target === undefined ? {} : {
      target: {
        id: operation.target.id,
        title: operation.target.title,
        ...(operation.target.updatedAt === undefined ? {} : { updatedAt: operation.target.updatedAt }),
      },
    }),
    ...(operation.result === undefined ? {} : {
      result: { itemId: operation.result.itemId, url: operation.result.url },
    }),
    ...(operation.errorCode === undefined ? {} : { errorCode: operation.errorCode }),
  }
}

function renderJson(value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function present(title: string, kind: 'read' | 'execute' | 'delete', rawInput?: string): GenericCallView {
  return { card: 'generic', title, kind, ...(rawInput === undefined ? {} : { rawInput }) }
}

/**
 * Validate direct plugin configuration.
 * @param config - Direct Consumer configuration.
 * @returns Complete validated timeout settings.
 */
export function resolveWorkItemsToolConfig(config: Config = {}): ResolvedConfig {
  return resolveConfig(config)
}

/** Register Work Items read and durable approval tools. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  ctx.systemPrompt.section({
    name: 'tool:work-items',
    order: 2950,
    text: WORK_ITEMS_SYSTEM_PROMPT,
  })

  ctx.tools.register(defineTool({
    name: 'work_items_list',
    description: 'List normalized Work Items from the configured GitHub, GitLab, or Linear provider.',
    parameters: {
      source: { type: 'string', enum: ['github', 'linear', 'gitlab'], description: 'Optional provider family; omit only when exactly one provider is usable.' },
      scope: { ...SCOPE_SCHEMA, description: 'Optional configured provider scope. GitHub requires owner and repository; Linear requires team or project; GitLab requires owner and repository.' },
      query: { type: 'string', description: 'Optional bounded title/body text filter.' },
      state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Optional provider-neutral state filter; defaults to open.' },
      cursor: { type: 'string', description: 'Opaque cursor returned by a prior page.' },
      limit: { type: 'integer', description: 'Maximum items to request, from 1 through 100.' },
    },
    output: { schema: PAGE_SCHEMA, render: (_args, value) => renderJson(value) },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return pageValue(await ctx.workItems.list(listRequest(args), exec.signal))
    },
    presentCall: args => present('List Work Items', 'read', args.source ?? args.scope?.source),
  }))

  ctx.tools.register(defineTool({
    name: 'work_items_get',
    description: 'Read one normalized Work Item by its opaque provider id.',
    parameters: {
      id: { type: 'string', required: true, description: 'Opaque id returned by work_items_list, such as github:owner/repository#123.' },
    },
    output: { schema: ITEM_SCHEMA, render: (_args, value) => renderJson(value) },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return itemValue(await ctx.workItems.get({ id: itemId(args.id) }, exec.signal))
    },
    presentCall: args => present(`Get Work Item ${args.id}`, 'read', args.id),
  }))

  ctx.tools.register(defineTool({
    name: 'work_items_prepare_write',
    description: 'Validate and durably preview one Work Item mutation without contacting the external provider to mutate it.',
    parameters: {
      mutation: { ...MUTATION_SCHEMA, required: true, description: 'Exact external mutation to preview. The returned operation_id is required for confirmation.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { operation: { ...OPERATION_SCHEMA, required: true } },
      },
      render: (_args, value) => renderJson(value),
    },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const operation = await ctx.workItems.prepareWrite(normalizeMutation(args.mutation), exec.signal)
      return { operation: operationValue(operation) }
    },
    presentCall: args => present('Preview Work Items change', 'execute', JSON.stringify(args.mutation)),
  }))

  ctx.tools.register(defineTool({
    name: 'work_items_confirm_write',
    description: 'Confirm exactly one previously persisted Work Items preview by operation_id; no replacement mutation is accepted.',
    parameters: {
      operation_id: { type: 'string', required: true, description: 'Exact operation_id returned by work_items_prepare_write or work_items_list_writes.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { operation: { ...OPERATION_SCHEMA, required: true } },
      },
      render: (_args, value) => renderJson(value),
    },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const operation = await ctx.workItems.confirmWrite(operationId(args.operation_id), exec.signal)
      return { operation: operationValue(operation) }
    },
    presentCall: args => present(`Confirm Work Items operation ${args.operation_id}`, 'execute', args.operation_id),
  }))

  ctx.tools.register(defineTool({
    name: 'work_items_cancel_write',
    description: 'Cancel one unexecuted Work Items preview by its exact persisted operation_id.',
    parameters: {
      operation_id: { type: 'string', required: true, description: 'Exact operation_id returned by work_items_prepare_write or work_items_list_writes.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { operation: { ...OPERATION_SCHEMA, required: true } },
      },
      render: (_args, value) => renderJson(value),
    },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const operation = await ctx.workItems.cancelWrite(operationId(args.operation_id))
      return { operation: operationValue(operation) }
    },
    presentCall: args => present(`Cancel Work Items operation ${args.operation_id}`, 'delete', args.operation_id),
  }))

  ctx.tools.register(defineTool({
    name: 'work_items_list_writes',
    description: 'Read durable Work Items previews and receipts for one provider family without issuing provider mutation requests.',
    parameters: {
      source: SOURCE_SCHEMA,
      limit: { type: 'integer', required: true, description: 'Maximum history rows, from 1 through 100.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          operations: { type: 'array', required: true, items: OPERATION_SCHEMA },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const operations = await ctx.workItems.listWrites(source(args.source), positiveLimit(args.limit))
      exec.signal.throwIfAborted()
      return { operations: operations.map(operationValue) }
    },
    presentCall: args => present(`List ${args.source} Work Items writes`, 'read', args.source),
  }))
}









