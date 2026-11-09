/** Read-only Gitee Issues provider using the fixed REST API v5 origin. */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { WorkItemId, WorkItemsError } from '@cinlan/work-items'
import type { WorkItem, WorkItemGetRequest, WorkItemListRequest, WorkItemPage, WorkItemsProvider } from '@cinlan/work-items'
import z from '@deepseek-ai/schemastery'

/** Cordis plugin name. */
export const name = 'work-items-gitee'
/** Services required by the Provider. */
export const inject = ['credentials', 'workItems']
/** Gitee's fixed API origin. */
export const GITEE_API_ORIGIN = 'https://gitee.com'
/** Provider id registered with ctx.workItems. */
export const GITEE_WORK_ITEMS_PROVIDER_ID = 'gitee' as const

const DEFAULT_CREDENTIAL_REF = 'GITEE_TOKEN'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_ITEMS = 50
const MAX_ITEMS = 100
const MAX_RESPONSE_BYTES = 2_000_000
const MAX_TEXT_LENGTH = 20_000
const MAX_QUERY_LENGTH = 500
const MAX_CURSOR_LENGTH = 16
const MAX_TIMEOUT_MS = 120_000

/** Gitee provider configuration. */
export interface Config {
  /** Repository owner; an omitted value leaves the Provider unavailable. */
  readonly owner?: string
  /** Repository name; an omitted value leaves the Provider unavailable. */
  readonly repository?: string
  /** CredentialRef resolved for every request; defaults to GITEE_TOKEN. */
  readonly credentialRef?: string
  /** Per-request timeout in milliseconds, from 1 through 120000. */
  readonly timeoutMs?: number
  /** Maximum issues requested per page, from 1 through 100. */
  readonly maxItems?: number
}

/** Loader schema for Gitee provider configuration. */
export const Config: z<Config> = z.object({
  owner: z.string(), repository: z.string(),
  credentialRef: z.string().role('credential-ref').default(DEFAULT_CREDENTIAL_REF),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS), maxItems: z.number().default(DEFAULT_MAX_ITEMS),
})

interface ResolvedConfig {
  readonly owner: string
  readonly repository: string
  readonly credentialRef: CredentialRef
  readonly timeoutMs: number
  readonly maxItems: number
}

const CONFIG_KEYS = new Set(['owner', 'repository', 'credentialRef', 'timeoutMs', 'maxItems'])

function configuredString(value: string | undefined, field: string): string {
  if (value === undefined) return ''
  if (value.length === 0 || value.length > 500 || value.trim() !== value || value.includes('/')) {
    throw new Error('work-items-gitee: ' + field + ' must be a non-empty repository path segment of at most 500 characters')
  }
  return value
}

function positiveInteger(value: number | undefined, fallback: number, field: string, maximum: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error('work-items-gitee: ' + field + ' must be a positive safe integer no greater than ' + String(maximum))
  }
  return resolved
}

/** Validate and resolve the deployment settings. @param config - Provider configuration. @returns Complete validated settings. */
export function resolveGiteeWorkItemsConfig(config: Config = {}): ResolvedConfig {
  for (const key of Object.keys(config)) if (!CONFIG_KEYS.has(key)) throw new Error("work-items-gitee: unsupported config key '" + key + "'")
  return {
    owner: configuredString(config.owner, 'owner'), repository: configuredString(config.repository, 'repository'),
    credentialRef: credentialRef(config.credentialRef ?? DEFAULT_CREDENTIAL_REF),
    timeoutMs: positiveInteger(config.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs', MAX_TIMEOUT_MS),
    maxItems: positiveInteger(config.maxItems, DEFAULT_MAX_ITEMS, 'maxItems', MAX_ITEMS),
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new WorkItemsError('invalid-response', 'Gitee returned an invalid Work Items response')
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT_LENGTH) throw new WorkItemsError('invalid-response', 'Gitee returned an invalid Work Item ' + field)
  return value
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) throw new WorkItemsError('invalid-response', 'Gitee returned an invalid Work Item ' + field)
  return value
}

function mapIssue(value: unknown, config: ResolvedConfig): WorkItem {
  const input = objectValue(value)
  const number = input.number
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1) throw new WorkItemsError('invalid-response', 'Gitee returned an invalid issue number')
  const url = requiredString(input.html_url, 'url')
  try {
    const parsed = new URL(url)
    const expectedPath = '/' + config.owner + '/' + config.repository + '/issues/' + String(number)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'gitee.com' || parsed.port !== '' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== expectedPath) throw new Error('invalid')
  } catch (cause) {
    throw new WorkItemsError('invalid-response', 'Gitee returned an invalid Work Item URL', { cause })
  }
  const body = optionalText(input.body, 'body')
  const labels = input.labels
  if (!Array.isArray(labels) || labels.length > 100 || labels.some(label => typeof label !== 'string' || label.length > MAX_TEXT_LENGTH)) {
    throw new WorkItemsError('invalid-response', 'Gitee returned invalid Work Item labels')
  }
  const assignees = input.assignees
  if (!Array.isArray(assignees) || assignees.length > 100) throw new WorkItemsError('invalid-response', 'Gitee returned invalid Work Item assignees')
  return {
    id: WorkItemId('gitee:' + config.owner + '/' + config.repository + '#' + String(number)),
    source: 'gitee', externalId: String(number), key: '#' + String(number),
    title: requiredString(input.title, 'title'), ...(body === undefined ? {} : { body }),
    state: requiredString(input.state, 'state'), url, repository: config.owner + '/' + config.repository,
    labels: [...labels] as string[], assignees: assignees.map(assignee => requiredString(objectValue(assignee).login, 'assignee')),
    ...(typeof input.created_at === 'string' && !Number.isNaN(Date.parse(input.created_at)) ? { createdAt: input.created_at } : {}),
    ...(typeof input.updated_at === 'string' && !Number.isNaN(Date.parse(input.updated_at)) ? { updatedAt: input.updated_at } : {}),
  }
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.body === null) throw new WorkItemsError('invalid-response', 'Gitee returned an empty response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const part = await reader.read()
      if (part.done) break
      total += part.value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw new WorkItemsError('invalid-response', 'Gitee response exceeded the byte limit')
      chunks.push(part.value)
      signal.throwIfAborted()
    }
  } finally {
    try { await reader.cancel() } catch (_streamAlreadyClosed) { /* The bounded response remains authoritative. */ }
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown }
  catch (cause) { throw new WorkItemsError('invalid-response', 'Gitee returned invalid JSON', { cause }) }
}

/** Read-only Gitee Issues provider for one configured repository. */
export class GiteeWorkItemsProvider implements WorkItemsProvider {
  readonly id = GITEE_WORK_ITEMS_PROVIDER_ID
  private disposed = false
  private readonly lifecycle = new AbortController()

  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig) {}

  /** Return repository availability without network or credential I/O. */
  available(): boolean { return !this.disposed && this.config.owner.length > 0 && this.config.repository.length > 0 }

  private assertAvailable(): void {
    if (!this.available()) throw new WorkItemsError('unavailable', 'Gitee Work Items repository is not configured or provider is disposed')
  }

  private assertRequest(request: WorkItemListRequest): void {
    if (request.source !== undefined && request.source !== 'gitee') throw new WorkItemsError('invalid-request', 'requested Work Items source is not Gitee')
    const scope = request.scope
    if (scope !== undefined && (scope.source !== 'gitee' || scope.owner !== this.config.owner || scope.repository !== this.config.repository)) {
      throw new WorkItemsError('invalid-request', 'requested Gitee scope is not configured')
    }
    if (request.query !== undefined && request.query.length > MAX_QUERY_LENGTH) throw new WorkItemsError('invalid-request', 'Work Items query is too long')
    if (request.cursor !== undefined && (!/^[1-9][0-9]{0,15}$/.test(request.cursor) || request.cursor.length > MAX_CURSOR_LENGTH || !Number.isSafeInteger(Number(request.cursor)))) throw new WorkItemsError('invalid-request', 'invalid Gitee page cursor')
  }

  private async request(path: string, signal?: AbortSignal): Promise<unknown> {
    this.assertAvailable()
    const timeout = AbortSignal.timeout(this.config.timeoutMs)
    const combined = AbortSignal.any([this.lifecycle.signal, timeout, ...(signal === undefined ? [] : [signal])])
    let response: Response
    try {
      const credentials = this.ctx.get('credentials')
      if (credentials === undefined) throw new WorkItemsError('authentication-required', 'Gitee credentials are not configured')
      const credential = await credentials.resolve(this.config.credentialRef)
      if (!credential?.value) throw new WorkItemsError('authentication-required', 'Gitee credentials are not configured')
      combined.throwIfAborted()
      response = await fetch(GITEE_API_ORIGIN + path, {
        headers: { accept: 'application/json', authorization: 'token ' + credential.value, 'user-agent': 'deepseek-harness' },
        redirect: 'error', signal: combined,
      })
    } catch (cause) {
      if (signal?.aborted || this.lifecycle.signal.aborted) throw new WorkItemsError('aborted', 'Gitee Work Items request was cancelled', { cause })
      if (timeout.aborted) throw new WorkItemsError('provider-failed', 'Gitee Work Items request timed out', { cause })
      if (cause instanceof WorkItemsError) throw cause
      throw new WorkItemsError('provider-failed', 'Gitee Work Items request failed', { cause })
    }
    if (response.status === 401) throw new WorkItemsError('authentication-required', 'Gitee credentials were rejected')
    if (response.status === 403) throw new WorkItemsError('forbidden', 'Gitee denied the Work Items request')
    if (response.status === 404) throw new WorkItemsError('not-found', 'Gitee Work Item was not found')
    if (response.status === 429) throw new WorkItemsError('rate-limited', 'Gitee rate limit was reached')
    if (!response.ok) throw new WorkItemsError('provider-failed', 'Gitee Work Items request failed with HTTP ' + String(response.status))
    return readJson(response, combined)
  }

  /** List a bounded page of repository issues.
   * @param request - Source, filter, page, and limit.
   * @param signal - Optional caller cancellation.
   * @returns Normalized issue page.
   */
  async list(request: WorkItemListRequest, signal?: AbortSignal): Promise<WorkItemPage> {
    this.assertRequest(request)
    const limit = request.limit ?? this.config.maxItems
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > this.config.maxItems) throw new WorkItemsError('invalid-request', 'Work Items limit is outside the configured bound')
    const page = request.cursor ?? '1'
    const query = new URLSearchParams({ state: request.state === 'closed' ? 'closed' : request.state === 'all' ? 'all' : 'open', sort: 'created', direction: 'desc', page, per_page: String(limit) })
    const path = '/api/v5/repos/' + encodeURIComponent(this.config.owner) + '/' + encodeURIComponent(this.config.repository) + '/issues?' + query
    const payload = await this.request(path, signal)
    if (!Array.isArray(payload) || payload.length > limit) throw new WorkItemsError('invalid-response', 'Gitee returned an invalid issue page')
    const items = payload.map(value => mapIssue(value, this.config)).filter(item => request.query === undefined || (item.title + '\n' + (item.body ?? '')).toLocaleLowerCase().includes(request.query.toLocaleLowerCase()))
    const truncated = payload.length === limit
    return { items, truncated, ...(truncated ? { nextCursor: String(Number(page) + 1) } : {}) }
  }

  /** Read one issue from the configured repository.
   * @param request - Opaque Gitee issue id.
   * @param signal - Optional caller cancellation.
   * @returns Normalized issue.
   */
  async get(request: WorkItemGetRequest, signal?: AbortSignal): Promise<WorkItem> {
    this.assertAvailable()
    const prefix = 'gitee:' + this.config.owner + '/' + this.config.repository + '#'
    const issueNumber = request.id.startsWith(prefix) ? request.id.slice(prefix.length) : ''
    if (!/^[1-9][0-9]*$/.test(issueNumber)) throw new WorkItemsError('invalid-request', 'Gitee Work Item id is outside the configured repository')
    const issue = mapIssue(await this.request('/api/v5/repos/' + encodeURIComponent(this.config.owner) + '/' + encodeURIComponent(this.config.repository) + '/issues/' + issueNumber, signal), this.config)
    if (issue.id !== request.id) throw new WorkItemsError('invalid-response', 'Gitee returned a different Work Item id')
    return issue
  }

  /** Abort pending requests and prevent future reads. */
  dispose(): void { if (this.disposed) return; this.disposed = true; this.lifecycle.abort() }
}

/** Register one configured Gitee repository provider. @param ctx - Cordis context. @param config - Loader configuration. */
export function apply(ctx: Context, config: Config = {}): void {
  const provider = new GiteeWorkItemsProvider(ctx, resolveGiteeWorkItemsConfig(config))
  ctx.effect(() => ctx.workItems.registerProvider(provider), 'work-items-gitee: provider')
}
