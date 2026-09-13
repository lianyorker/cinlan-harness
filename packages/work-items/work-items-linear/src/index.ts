/** Linear Work Items reads and opt-in writes using the fixed GraphQL endpoint. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { WorkItemId, WorkItemsError } from '@deepseek-ai/dsh-work-items'
import type { WorkItem, WorkItemGetRequest, WorkItemListRequest, WorkItemPage, WorkItemsProvider } from '@deepseek-ai/dsh-work-items'
import z from '@deepseek-ai/schemastery'
import type { WorkItemMutation, WorkItemMutationResult, WorkItemsWriter } from '@deepseek-ai/dsh-work-items/types'

/** Cordis plugin name. */
export const name = 'work-items-linear'
/** Services required by the Provider. */
export const inject = ['credentials', 'workItems']

/** Linear's fixed API origin; it is not configurable or request-controlled. */
export const LINEAR_API_ORIGIN = 'https://api.linear.app'
/** Provider id registered with ctx.workItems. */
export const LINEAR_WORK_ITEMS_PROVIDER_ID = 'linear' as const

const DEFAULT_CREDENTIAL_REF = 'LINEAR_API_KEY'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_ITEMS = 50
const MAX_ITEMS = 100
const MAX_RESPONSE_BYTES = 2_000_000
const MAX_TEXT_LENGTH = 20_000
const MAX_QUERY_LENGTH = 500
const MAX_CURSOR_LENGTH = 500
const MAX_TIMEOUT_MS = 120_000
const ISSUE_FIELDS = 'id identifier title description url createdAt updatedAt state { name type } labels { nodes { name } } assignee { name }'

/** Linear provider configuration. */
export interface Config {
  /** Enable confirmed external mutations; disabled by default. */
  readonly allowWrites?: boolean
  /** Linear team id; at least one configured team or project makes the Provider available. */
  readonly team?: string
  /** Linear project id; at least one configured team or project makes the Provider available. */
  readonly project?: string
  /** CredentialRef resolved for every request; defaults to LINEAR_API_KEY. */
  readonly credentialRef?: string
  /** Per-request timeout in milliseconds, from 1 through 120000. */
  readonly timeoutMs?: number
  /** Maximum issues requested and returned per page, from 1 through 100. */
  readonly maxItems?: number
}

/** Loader schema for Linear provider configuration. */
export const Config: z<Config> = z.object({
  allowWrites: z.boolean().default(false),
  team: z.string(),
  project: z.string(),
  credentialRef: z.string().role('credential-ref').default(DEFAULT_CREDENTIAL_REF),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  maxItems: z.number().default(DEFAULT_MAX_ITEMS),
})

interface ResolvedConfig {
  readonly allowWrites: boolean
  readonly team: string
  readonly project: string
  readonly credentialRef: CredentialRef
  readonly timeoutMs: number
  readonly maxItems: number
}

const CONFIG_KEYS = new Set(['allowWrites', 'team', 'project', 'credentialRef', 'timeoutMs', 'maxItems'])

function configuredString(value: string | undefined, field: string): string {
  if (value === undefined) return ''
  if (value.length === 0 || value.length > MAX_CURSOR_LENGTH || value.trim() !== value) {
    throw new Error('work-items-linear: ' + field + ' must be non-empty, trimmed, and at most ' + String(MAX_CURSOR_LENGTH) + ' characters when configured')
  }
  return value
}

function positiveInteger(value: number | undefined, fallback: number, field: string, maximum: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error('work-items-linear: ' + field + ' must be a positive safe integer no greater than ' + String(maximum))
  }
  return resolved
}


/** Return a non-disclosing credential identity for durable scope comparisons. */
function credentialScopeFingerprint(ref: CredentialRef): string {
  return createHash('sha256').update(ref).digest('hex')
}

function requestLimit(value: number | undefined, fallback: number, maximum: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new WorkItemsError('invalid-request', 'Work Items limit must be a positive safe integer no greater than ' + String(maximum))
  }
  return resolved
}

/**
 * Validate and resolve Linear deployment settings.
 * @param config - Loader or direct Provider configuration.
 * @returns Complete validated settings.
 */
export function resolveLinearWorkItemsConfig(config: Config = {}): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error("work-items-linear: unsupported config key '" + key + "'")
  }
  if (config.allowWrites !== undefined && typeof config.allowWrites !== 'boolean') throw new Error('allowWrites must be boolean')
  return {
    allowWrites: config.allowWrites ?? false,
    team: configuredString(config.team, 'team'),
    project: configuredString(config.project, 'project'),
    credentialRef: credentialRef(config.credentialRef ?? DEFAULT_CREDENTIAL_REF),
    timeoutMs: positiveInteger(config.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs', MAX_TIMEOUT_MS),
    maxItems: positiveInteger(config.maxItems, DEFAULT_MAX_ITEMS, 'maxItems', MAX_ITEMS),
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WorkItemsError('invalid-response', 'Linear returned an invalid Work Items response')
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT_LENGTH) {
    throw new WorkItemsError('invalid-response', 'Linear returned an invalid Work Item ' + field)
  }
  return value
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined
  return requiredString(value, field)
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) {
    throw new WorkItemsError('invalid-response', 'Linear returned an invalid Work Item ' + field)
  }
  return value
}

function optionalTimestamp(value: unknown, field: string): string | undefined {
  const timestamp = optionalString(value, field)
  if (timestamp !== undefined && Number.isNaN(Date.parse(timestamp))) {
    throw new WorkItemsError('invalid-response', 'Linear returned an invalid Work Item ' + field)
  }
  return timestamp
}

function issueUrl(value: unknown): string {
  const url = requiredString(value, 'url')
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'linear.app' || parsed.port !== '' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('invalid')
    return parsed.href
  } catch (error) {
    throw new WorkItemsError('invalid-response', 'Linear returned an invalid Work Item URL', { cause: error })
  }
}


function providerItemId(value: string): ReturnType<typeof WorkItemId> {
  try {
    return WorkItemId(value)
  } catch (error) {
    throw new WorkItemsError('invalid-response', 'Provider returned an invalid Work Item id', { cause: error })
  }
}

function mapIssue(value: unknown): WorkItem {
  const input = objectValue(value)
  const state = objectValue(input.state)
  const labels = objectValue(input.labels)
  if (!Array.isArray(labels.nodes) || labels.nodes.length > 100) throw new WorkItemsError('invalid-response', 'Linear returned invalid Work Item labels')
  const assignee = input.assignee === null || input.assignee === undefined ? undefined : optionalString(objectValue(input.assignee).name, 'assignee')
  const body = optionalText(input.description, 'body')
  const createdAt = optionalTimestamp(input.createdAt, 'createdAt')
  const updatedAt = optionalTimestamp(input.updatedAt, 'updatedAt')
  return {
    id: providerItemId('linear:' + requiredString(input.id, 'id')),
    source: 'linear',
    externalId: requiredString(input.id, 'id'),
    key: requiredString(input.identifier, 'identifier'),
    title: requiredString(input.title, 'title'),
    ...(body === undefined ? {} : { body }),
    state: requiredString(state.name, 'state'),
    url: issueUrl(input.url),
    labels: labels.nodes.map(entry => requiredString(objectValue(entry).name, 'label')),
    assignees: assignee === undefined ? [] : [assignee],
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  }
}


async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel()
  } catch {
    // The bounded read result remains authoritative; stream cleanup is best-effort.
  }
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.body === null) return undefined
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw new WorkItemsError('invalid-response', 'Linear response exceeded the byte limit')
      chunks.push(next.value)
      signal.throwIfAborted()
    }
  } finally {
    await cancelReader(reader)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new WorkItemsError('invalid-response', 'Linear returned invalid JSON', { cause: error })
  }
}

function requestError(error: unknown, signal: AbortSignal | undefined, timedOut: AbortSignal, disposed: AbortSignal): WorkItemsError {
  if (signal?.aborted === true || disposed.aborted) return new WorkItemsError('aborted', 'Linear Work Items request was cancelled', { cause: error })
  if (timedOut.aborted) return new WorkItemsError('provider-failed', 'Linear Work Items request timed out', { cause: error })
  return new WorkItemsError('provider-failed', 'Linear Work Items request failed', { cause: error })
}

/** Linear GraphQL provider for one configured team or project. */
export class LinearWorkItemsProvider implements WorkItemsProvider {
  readonly id = LINEAR_WORK_ITEMS_PROVIDER_ID
  private disposed = false
  private readonly lifecycle = new AbortController()

  readonly writer?: WorkItemsWriter

  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig) {
    if (config.allowWrites) this.writer = {
      scope: JSON.stringify([config.team, config.project, 'sha256:' + credentialScopeFingerprint(config.credentialRef)]),
      validate: (mutation, signal) => this.validateMutation(mutation, signal),
      execute: (mutation, signal) => this.executeMutation(mutation, signal),
    }
  }

  /** Return scope availability without network or credential I/O. */
  available(): boolean {
    return !this.disposed && (this.config.team.length > 0 || this.config.project.length > 0)
  }

  private assertAvailable(): void {
    if (this.disposed) throw new WorkItemsError('unavailable', 'Linear Work Items provider is disposed')
    if (this.config.team.length === 0 && this.config.project.length === 0) {
      throw new WorkItemsError('unavailable', 'Linear Work Items scope is not configured')
    }
  }

  private assertScope(request: WorkItemListRequest): void {
    if (request.source !== undefined && request.source !== 'linear') throw new WorkItemsError('invalid-request', 'requested Work Items source is not Linear')
    const scope = request.scope
    if (scope !== undefined && (scope.source !== 'linear' || (scope.team !== undefined && scope.team !== this.config.team) || (scope.project !== undefined && scope.project !== this.config.project))) {
      throw new WorkItemsError('invalid-request', 'requested Linear scope is not configured')
    }
    if (request.query !== undefined && request.query.length > MAX_QUERY_LENGTH) throw new WorkItemsError('invalid-request', 'Work Items query is too long')
    if (request.cursor !== undefined && request.cursor.length > MAX_CURSOR_LENGTH) throw new WorkItemsError('invalid-request', 'Work Items cursor is too long')
  }

  private async token(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) throw new WorkItemsError('authentication-required', 'Linear credentials are not configured')
    try {
      const resolved = await credentials.resolve(this.config.credentialRef)
      signal.throwIfAborted()
      if (resolved?.value === undefined || resolved.value.length === 0) throw new Error('missing')
      return resolved.value
    } catch (error) {
      if (signal.aborted) throw signal.reason
      if (error instanceof WorkItemsError) throw error
      throw new WorkItemsError('authentication-required', 'Linear credentials are not configured', { cause: error })
    }
  }

  private async request(body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs)
    const combined = AbortSignal.any([this.lifecycle.signal, timeout, ...(signal === undefined ? [] : [signal])])
    let response: Response
    try {
      const token = await this.token(combined)
      response = await fetch(LINEAR_API_ORIGIN + '/graphql', {
        method: 'POST',
        redirect: 'error',
        headers: { accept: 'application/json', authorization: token, 'content-type': 'application/json', 'user-agent': 'deepseek-harness' },
        body: JSON.stringify(body),
        signal: combined,
      })
    } catch (error) {
      if (error instanceof WorkItemsError) throw error
      throw requestError(error, signal, timeout, this.lifecycle.signal)
    }
    if (response.status === 401) throw new WorkItemsError('authentication-required', 'Linear rejected the configured credentials')
    if (response.status === 403) throw new WorkItemsError('forbidden', 'Linear denied access to the configured scope')
    if (response.status === 404) throw new WorkItemsError('not-found', 'Linear Work Item was not found')
    if (response.status === 429) throw new WorkItemsError('rate-limited', 'Linear rate limited the Work Items request')
    if (response.status === 400 || response.status === 422) throw new WorkItemsError('write-rejected', 'Linear rejected the mutation fields')
    if (!response.ok) throw new WorkItemsError('provider-failed', 'Linear Work Items returned HTTP ' + String(response.status))
    let responseBody: unknown
    try {
      responseBody = await readJson(response, combined)
    } catch (error) {
      if (error instanceof WorkItemsError) throw error
      throw requestError(error, signal, timeout, this.lifecycle.signal)
    }
    const raw = objectValue(responseBody)
    const errors = raw.errors
    if (Array.isArray(errors) && errors.length > 0) {
      const code: unknown = errors.find(error => typeof error === 'object' && error !== null && !Array.isArray(error) && typeof (error as Record<string, unknown>).extensions === 'object')
      const extensionCode = code === undefined ? undefined : objectValue((code as Record<string, unknown>).extensions).code
      if (extensionCode === 'AUTHENTICATION_ERROR') throw new WorkItemsError('authentication-required', 'Linear rejected the configured credentials')
      if (extensionCode === 'FORBIDDEN') throw new WorkItemsError('forbidden', 'Linear denied access to the configured scope')
      if (extensionCode === 'BAD_USER_INPUT' || extensionCode === 'INPUT_ERROR') throw new WorkItemsError('write-rejected', 'Linear rejected the mutation fields')
      throw new WorkItemsError('provider-failed', 'Linear returned a GraphQL error')
    }
    return raw.data
  }

  /** List issues from the configured Linear scope. */
  async list(request: WorkItemListRequest = {}, signal?: AbortSignal): Promise<WorkItemPage> {
    this.assertAvailable()
    this.assertScope(request)
    const limit = requestLimit(request.limit, this.config.maxItems, this.config.maxItems)
    const after = request.cursor === undefined ? null : request.cursor
    const filter: Record<string, unknown> = {}
    if (this.config.team.length > 0) filter.team = { id: { eq: this.config.team } }
    if (this.config.project.length > 0) filter.project = { id: { eq: this.config.project } }
    const state = request.state ?? 'open'
    if (state === 'open') filter.state = { type: { nin: ['completed', 'canceled'] } }
    if (state === 'closed') filter.state = { type: { in: ['completed', 'canceled'] } }
    const query = 'query($first: Int!, $after: String, $filter: IssueFilter) { issues(first: $first, after: $after, filter: $filter) { nodes { ' + ISSUE_FIELDS + ' } pageInfo { hasNextPage endCursor } } }'
    const data = objectValue(await this.request({ query, variables: { first: limit, after, filter } }, signal))
    const issues = objectValue(data.issues)
    if (!Array.isArray(issues.nodes) || issues.nodes.length > limit) throw new WorkItemsError('invalid-response', 'Linear issue list was invalid or exceeded its bound')
    const mapped = issues.nodes.map(mapIssue)
    const queryText = request.query?.toLocaleLowerCase()
    const filtered = queryText === undefined || queryText.length === 0 ? mapped : mapped.filter(value => (value.title + '\n' + (value.body ?? '')).toLocaleLowerCase().includes(queryText))
    const pageInfo = objectValue(issues.pageInfo)
    const hasNext = pageInfo.hasNextPage === true
    const endCursor = pageInfo.endCursor
    if (hasNext && typeof endCursor !== 'string') throw new WorkItemsError('invalid-response', 'Linear pagination cursor is invalid')
    return { items: filtered, ...(hasNext && typeof endCursor === 'string' ? { nextCursor: endCursor } : {}), truncated: false }
  }

  /** Read one issue by Linear UUID. */
  async get(request: WorkItemGetRequest, signal?: AbortSignal): Promise<WorkItem> {
    this.assertAvailable()
    const prefix = 'linear:'
    if (!String(request.id).startsWith(prefix) || String(request.id).length > MAX_CURSOR_LENGTH || String(request.id).slice(prefix.length).length === 0) throw new WorkItemsError('invalid-request', 'Work Item id does not belong to Linear')
    const data = objectValue(await this.request({ query: 'query($id: String!) { issue(id: $id) { ' + ISSUE_FIELDS + ' } }', variables: { id: String(request.id).slice(prefix.length) } }, signal))
    if (data.issue === null || data.issue === undefined) throw new WorkItemsError('not-found', 'Linear Work Item was not found')
    return mapIssue(data.issue)
  }

  private async scopedIssue(id: string, signal?: AbortSignal): Promise<{ id: string; teamId: string; url: string }> {
    if (!id.startsWith('linear:') || id.length <= 7) throw new WorkItemsError('invalid-request', 'Wrong Work Items source')
    const externalId = id.slice(7)
    const data = objectValue(await this.request({
      query: 'query($id: String!) { issue(id: $id) { id url team { id } project { id } } }',
      variables: { id: externalId },
    }, signal))
    if (data.issue === null || data.issue === undefined) throw new WorkItemsError('not-found', 'Linear issue was not found')
    const issue = objectValue(data.issue)
    const teamId = requiredString(objectValue(issue.team).id, 'team id')
    const projectId = issue.project === null ? undefined : objectValue(issue.project).id
    if (issue.id !== externalId || this.config.team && teamId !== this.config.team
      || this.config.project && projectId !== this.config.project) {
      throw new WorkItemsError('forbidden', 'Linear issue is outside the configured scope')
    }
    return { id: externalId, teamId, url: issueUrl(issue.url) }
  }

  private async validateMutation(mutation: WorkItemMutation, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    this.assertAvailable()
    if (!this.config.allowWrites) throw new WorkItemsError('write-disabled', 'Linear writes are disabled')
    if (mutation.kind === 'create') {
      if (mutation.source !== 'linear' || !this.config.team) throw new WorkItemsError('invalid-request', 'Creating Linear issues requires a configured team')
      return
    }
    const issue = await this.scopedIssue(mutation.id, signal)
    if (mutation.kind === 'state') {
      const data = objectValue(await this.request({ query: 'query($id: String!) { workflowState(id: $id) { id team { id } } }', variables: { id: mutation.state } }, signal))
      const state = objectValue(data.workflowState)
      if (state.id !== mutation.state || objectValue(state.team).id !== issue.teamId) throw new WorkItemsError('invalid-request', 'Workflow state must belong to the issue team')
    }
    if (mutation.kind === 'assign' && (mutation.assignees.length > 1 || mutation.assignees.some(id => !/^[0-9a-f-]{36}$/i.test(id)))) {
      throw new WorkItemsError('invalid-request', 'Linear accepts one assignee UUID or an empty list')
    }
  }

  private async executeMutation(mutation: WorkItemMutation, signal?: AbortSignal): Promise<WorkItemMutationResult> {
    await this.validateMutation(mutation, signal)
    if (mutation.kind === 'create') {
      const data = objectValue(await this.request({
        query: 'mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id url } } }',
        variables: { input: {
          title: mutation.title, description: mutation.body, teamId: this.config.team,
          ...(this.config.project ? { projectId: this.config.project } : {}),
        } },
      }, signal))
      const result = objectValue(data.issueCreate)
      if (result.success !== true) throw new WorkItemsError('write-rejected', 'Linear did not create the issue')
      const issue = objectValue(result.issue)
      return { itemId: WorkItemId('linear:' + requiredString(issue.id, 'id')), url: issueUrl(issue.url) }
    }
    const issue = await this.scopedIssue(mutation.id, signal)
    if (mutation.kind === 'comment') {
      const data = objectValue(await this.request({
        query: 'mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id } } }',
        variables: { input: { issueId: issue.id, body: mutation.body } },
      }, signal))
      const result = objectValue(data.commentCreate)
      if (result.success !== true) throw new WorkItemsError('write-rejected', 'Linear did not create the comment')
      requiredString(objectValue(result.comment).id, 'comment id')
    } else {
      const input = mutation.kind === 'state' ? { stateId: mutation.state } : { assigneeId: mutation.assignees[0] ?? null }
      const data = objectValue(await this.request({
        query: 'mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { id } } }',
        variables: { id: issue.id, input },
      }, signal))
      const result = objectValue(data.issueUpdate)
      if (result.success !== true) throw new WorkItemsError('write-rejected', 'Linear did not update the issue')
      if (objectValue(result.issue).id !== issue.id) throw new WorkItemsError('invalid-response', 'Linear returned a different issue')
    }
    return { itemId: mutation.id, url: issue.url }
  }

  /** Stop future provider operations. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.lifecycle.abort()
  }
}

/** Register the configured Linear provider. */
export function apply(ctx: Context, config: Config = {}): void {
  const provider = new LinearWorkItemsProvider(ctx, resolveLinearWorkItemsConfig(config))
  ctx.effect(() => ctx.workItems.registerProvider(provider), 'work-items-linear: provider')
}
