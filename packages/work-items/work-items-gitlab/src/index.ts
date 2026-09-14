/** GitLab Work Items reads and opt-in writes using the REST API v4. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { WorkItemId, WorkItemsError } from '@deepseek-ai/dsh-work-items'
import type { WorkItem, WorkItemGetRequest, WorkItemListRequest, WorkItemPage, WorkItemsProvider } from '@deepseek-ai/dsh-work-items'
import z from '@deepseek-ai/schemastery'
import type { WorkItemMutation, WorkItemMutationResult, WorkItemsWriter } from '@deepseek-ai/dsh-work-items/types'

/** Cordis plugin name. */
export const name = 'work-items-gitlab'
/** Services required by the Provider. */
export const inject = ['credentials', 'workItems']

/** GitLab's default API origin; configurable for self-hosted instances. */
export const GITLAB_API_ORIGIN = 'https://gitlab.com'
/** Provider id registered with ctx.workItems. */
export const GITLAB_WORK_ITEMS_PROVIDER_ID = 'gitlab' as const

const DEFAULT_CREDENTIAL_REF = 'GITLAB_TOKEN'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_ITEMS = 50
const MAX_ITEMS = 100
const MAX_RESPONSE_BYTES = 2_000_000
const MAX_TEXT_LENGTH = 20_000
const MAX_QUERY_LENGTH = 500
const MAX_CURSOR_LENGTH = 500
const MAX_TIMEOUT_MS = 120_000

/** GitLab provider configuration. */
export interface Config {
  /** Enable confirmed external mutations; disabled by default. */
  readonly allowWrites?: boolean
  /** GitLab namespace (group or user); an omitted value leaves the Provider unavailable. */
  readonly owner?: string
  /** GitLab project name; an omitted value leaves the Provider unavailable. */
  readonly repository?: string
  /** GitLab API origin; defaults to https://gitlab.com for self-hosted instances. */
  readonly origin?: string
  /** CredentialRef resolved for every request; defaults to GITLAB_TOKEN. */
  readonly credentialRef?: string
  /** Per-request timeout in milliseconds, from 1 through 120000. */
  readonly timeoutMs?: number
  /** Maximum issues requested and returned per page, from 1 through 100. */
  readonly maxItems?: number
}

/** Loader schema for GitLab provider configuration. */
export const Config: z<Config> = z.object({
  allowWrites: z.boolean().default(false),
  owner: z.string(),
  repository: z.string(),
  origin: z.string().default(GITLAB_API_ORIGIN),
  credentialRef: z.string().role('credential-ref').default(DEFAULT_CREDENTIAL_REF),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  maxItems: z.number().default(DEFAULT_MAX_ITEMS),
})

interface ResolvedConfig {
  readonly allowWrites: boolean
  readonly owner: string
  readonly repository: string
  readonly origin: string
  readonly credentialRef: CredentialRef
  readonly timeoutMs: number
  readonly maxItems: number
}

const CONFIG_KEYS = new Set(['allowWrites', 'owner', 'repository', 'origin', 'credentialRef', 'timeoutMs', 'maxItems'])

function configuredString(value: string | undefined, field: string): string {
  if (value === undefined) return ''
  if (value.length === 0 || value.length > MAX_CURSOR_LENGTH || value.trim() !== value) {
    throw new Error('work-items-gitlab: ' + field + ' must be non-empty, trimmed, and at most ' + String(MAX_CURSOR_LENGTH) + ' characters when configured')
  }
  return value
}

function positiveInteger(value: number | undefined, fallback: number, field: string, maximum: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error('work-items-gitlab: ' + field + ' must be a positive safe integer no greater than ' + String(maximum))
  }
  return resolved
}

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
 * Validate and resolve GitLab deployment settings.
 * @param config - Loader or direct Provider configuration.
 * @returns Complete validated settings.
 */
export function resolveGitLabWorkItemsConfig(config: Config = {}): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error("work-items-gitlab: unsupported config key '" + key + "'")
  }
  if (config.allowWrites !== undefined && typeof config.allowWrites !== 'boolean') throw new Error('allowWrites must be boolean')
  const origin = configuredString(config.origin, 'origin') || GITLAB_API_ORIGIN
  let parsedOrigin: URL
  try {
    parsedOrigin = new URL(origin)
    if (parsedOrigin.protocol !== 'https:' || parsedOrigin.username || parsedOrigin.password || parsedOrigin.search || parsedOrigin.hash) throw new Error('invalid')
  } catch (error) {
    throw new Error('work-items-gitlab: origin must be a clean https URL', { cause: error })
  }
  return {
    allowWrites: config.allowWrites ?? false,
    owner: configuredString(config.owner, 'owner'),
    repository: configuredString(config.repository, 'repository'),
    origin: parsedOrigin.origin,
    credentialRef: credentialRef(config.credentialRef ?? DEFAULT_CREDENTIAL_REF),
    timeoutMs: positiveInteger(config.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs', MAX_TIMEOUT_MS),
    maxItems: positiveInteger(config.maxItems, DEFAULT_MAX_ITEMS, 'maxItems', MAX_ITEMS),
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WorkItemsError('invalid-response', 'GitLab returned an invalid Work Items response')
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT_LENGTH) {
    throw new WorkItemsError('invalid-response', 'GitLab returned an invalid Work Item ' + field)
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
    throw new WorkItemsError('invalid-response', 'GitLab returned an invalid Work Item ' + field)
  }
  return value
}

function optionalTimestamp(value: unknown, field: string): string | undefined {
  const timestamp = optionalString(value, field)
  if (timestamp !== undefined && Number.isNaN(Date.parse(timestamp))) {
    throw new WorkItemsError('invalid-response', 'GitLab returned an invalid Work Item ' + field)
  }
  return timestamp
}

function issueUrl(value: unknown, origin: string): string {
  const url = requiredString(value, 'url')
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.port !== '' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('invalid')
    const expected = new URL(origin)
    if (parsed.hostname !== expected.hostname) throw new Error('invalid')
    return parsed.href
  } catch (error) {
    throw new WorkItemsError('invalid-response', 'GitLab returned an invalid Work Item URL', { cause: error })
  }
}

function names(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new WorkItemsError('invalid-response', 'GitLab returned invalid Work Item labels')
  return value.map(entry => requiredString(objectValue(entry).name, 'label'))
}

function usernames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new WorkItemsError('invalid-response', 'GitLab returned invalid Work Item assignees')
  return value.map(entry => requiredString(objectValue(entry).username, 'assignee'))
}

function providerItemId(value: string): ReturnType<typeof WorkItemId> {
  try {
    return WorkItemId(value)
  } catch (error) {
    throw new WorkItemsError('invalid-response', 'Provider returned an invalid Work Item id', { cause: error })
  }
}

function projectPath(config: ResolvedConfig): string {
  return encodeURIComponent(config.owner + '/' + config.repository)
}

function mapIssue(value: unknown, config: ResolvedConfig): WorkItem {
  const input = objectValue(value)
  const iid = input.iid
  if (typeof iid !== 'number' || !Number.isSafeInteger(iid) || iid < 1) throw new WorkItemsError('invalid-response', 'GitLab returned an invalid issue iid')
  const body = optionalText(input.description, 'body')
  const createdAt = optionalTimestamp(input.created_at, 'createdAt')
  const updatedAt = optionalTimestamp(input.updated_at, 'updatedAt')
  return {
    id: providerItemId('gitlab:' + config.owner + '/' + config.repository + '#' + String(iid)),
    source: 'gitlab',
    externalId: String(iid),
    key: '#' + String(iid),
    title: requiredString(input.title, 'title'),
    ...(body === undefined ? {} : { body }),
    state: requiredString(input.state, 'state'),
    url: issueUrl(input.web_url, config.origin),
    repository: config.owner + '/' + config.repository,
    labels: names(input.labels),
    assignees: usernames(input.assignees),
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
      if (total > MAX_RESPONSE_BYTES) throw new WorkItemsError('invalid-response', 'GitLab response exceeded the byte limit')
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
    throw new WorkItemsError('invalid-response', 'GitLab returned invalid JSON', { cause: error })
  }
}

function requestError(error: unknown, signal: AbortSignal | undefined, timedOut: AbortSignal, disposed: AbortSignal): WorkItemsError {
  if (signal?.aborted === true || disposed.aborted) return new WorkItemsError('aborted', 'GitLab Work Items request was cancelled', { cause: error })
  if (timedOut.aborted) return new WorkItemsError('provider-failed', 'GitLab Work Items request timed out', { cause: error })
  return new WorkItemsError('provider-failed', 'GitLab Work Items request failed', { cause: error })
}

/** GitLab REST provider for one configured project. */
export class GitLabWorkItemsProvider implements WorkItemsProvider {
  readonly id = GITLAB_WORK_ITEMS_PROVIDER_ID
  private disposed = false
  private readonly lifecycle = new AbortController()

  readonly writer?: WorkItemsWriter

  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig) {
    if (config.allowWrites) this.writer = {
      scope: JSON.stringify([config.owner, config.repository, 'sha256:' + credentialScopeFingerprint(config.credentialRef)]),
      validate: (mutation, signal) => Promise.resolve().then(() => { this.validateMutation(mutation, signal) }),
      execute: (mutation, signal) => this.executeMutation(mutation, signal),
    }
  }

  /** Return scope availability without network or credential I/O. */
  available(): boolean {
    return !this.disposed && this.config.owner.length > 0 && this.config.repository.length > 0
  }

  private assertAvailable(): void {
    if (this.disposed) throw new WorkItemsError('unavailable', 'GitLab Work Items provider is disposed')
    if (this.config.owner.length === 0 || this.config.repository.length === 0) {
      throw new WorkItemsError('unavailable', 'GitLab Work Items project is not configured')
    }
  }

  private assertScope(request: WorkItemListRequest): void {
    if (request.source !== undefined && request.source !== 'gitlab') throw new WorkItemsError('invalid-request', 'requested Work Items source is not GitLab')
    const scope = request.scope
    if (scope !== undefined && (scope.source !== 'gitlab' || scope.owner !== this.config.owner || scope.repository !== this.config.repository)) {
      throw new WorkItemsError('invalid-request', 'requested GitLab scope is not configured')
    }
    if (request.query !== undefined && request.query.length > MAX_QUERY_LENGTH) throw new WorkItemsError('invalid-request', 'Work Items query is too long')
    if (request.cursor !== undefined && request.cursor.length > MAX_CURSOR_LENGTH) throw new WorkItemsError('invalid-request', 'Work Items cursor is too long')
  }

  private async token(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) throw new WorkItemsError('authentication-required', 'GitLab credentials are not configured')
    try {
      const resolved = await credentials.resolve(this.config.credentialRef)
      signal.throwIfAborted()
      if (resolved?.value === undefined || resolved.value.length === 0) throw new Error('missing')
      return resolved.value
    } catch (error) {
      if (signal.aborted) throw signal.reason
      if (error instanceof WorkItemsError) throw error
      throw new WorkItemsError('authentication-required', 'GitLab credentials are not configured', { cause: error })
    }
  }

  private async request(path: string, signal?: AbortSignal, mutation?: { method: 'POST' | 'PUT'; body: unknown }): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs)
    const combined = AbortSignal.any([this.lifecycle.signal, timeout, ...(signal === undefined ? [] : [signal])])
    let response: Response
    try {
      const token = await this.token(combined)
      response = await fetch(this.config.origin + path, {
        method: mutation?.method ?? 'GET',
        ...(mutation === undefined ? {} : { body: JSON.stringify(mutation.body) }),
        redirect: 'error',
        headers: {
          accept: 'application/json',
          ...(mutation === undefined ? {} : { 'content-type': 'application/json' }),
          'PRIVATE-TOKEN': token,
          'user-agent': 'deepseek-harness',
        },
        signal: combined,
      })
    } catch (error) {
      if (error instanceof WorkItemsError) throw error
      throw requestError(error, signal, timeout, this.lifecycle.signal)
    }
    if (response.status === 401) throw new WorkItemsError('authentication-required', 'GitLab rejected the configured credentials')
    if (response.status === 403) throw new WorkItemsError('forbidden', 'GitLab denied access to the configured project')
    if (response.status === 404) throw new WorkItemsError('not-found', 'GitLab project or Work Item was not found')
    if (response.status === 429) throw new WorkItemsError('rate-limited', 'GitLab rate limited the Work Items request')
    if (response.status === 400 || response.status === 422) throw new WorkItemsError('write-rejected', 'GitLab rejected the mutation fields')
    if (!response.ok) throw new WorkItemsError('provider-failed', 'GitLab Work Items returned HTTP ' + String(response.status))
    try {
      return await readJson(response, combined)
    } catch (error) {
      if (error instanceof WorkItemsError) throw error
      throw requestError(error, signal, timeout, this.lifecycle.signal)
    }
  }

  /** List issues from the configured project. */
  async list(request: WorkItemListRequest = {}, signal?: AbortSignal): Promise<WorkItemPage> {
    this.assertAvailable()
    this.assertScope(request)
    const limit = requestLimit(request.limit, this.config.maxItems, this.config.maxItems)
    const page = request.cursor === undefined ? 1 : Number(request.cursor)
    if (!Number.isSafeInteger(page) || page < 1) throw new WorkItemsError('invalid-request', 'GitLab cursor must be a positive page number')
    const state = request.state === 'closed' ? 'closed' : request.state === 'all' ? 'all' : 'opened'
    const params = new URLSearchParams({ state, per_page: String(limit), page: String(page) })
    const path = '/api/v4/projects/' + projectPath(this.config) + '/issues?' + params.toString()
    const raw = await this.request(path, signal)
    if (!Array.isArray(raw) || raw.length > limit) throw new WorkItemsError('invalid-response', 'GitLab issue list was invalid or exceeded its bound')
    const items = raw.map(value => mapIssue(value, this.config))
    const query = request.query?.toLocaleLowerCase()
    const filtered = query === undefined || query.length === 0
      ? items
      : items.filter(value => (value.title + '\n' + (value.body ?? '')).toLocaleLowerCase().includes(query))
    return { items: filtered, ...(raw.length === limit ? { nextCursor: String(page + 1) } : {}), truncated: false }
  }

  /** Read one issue from the configured project. */
  async get(request: WorkItemGetRequest, signal?: AbortSignal): Promise<WorkItem> {
    this.assertAvailable()
    const match = /^gitlab:([^/]+)\/([^#]+)#([1-9][0-9]*)$/.exec(String(request.id))
    if (match === null || match[3] === undefined || match[1] !== this.config.owner || match[2] !== this.config.repository) {
      throw new WorkItemsError('invalid-request', 'Work Item id does not belong to the configured GitLab project')
    }
    const raw = await this.request('/api/v4/projects/' + projectPath(this.config) + '/issues/' + match[3], signal)
    return mapIssue(raw, this.config)
  }

  private issueIid(id: string): string {
    const match = /^gitlab:([^/]+)\/([^#]+)#([1-9][0-9]*)$/.exec(id)
    if (match === null || match[3] === undefined || match[1] !== this.config.owner || match[2] !== this.config.repository) {
      throw new WorkItemsError('invalid-request', 'Work Item is outside the configured project')
    }
    return match[3]
  }

  private validateMutation(mutation: WorkItemMutation, signal?: AbortSignal): void {
    signal?.throwIfAborted()
    this.assertAvailable()
    if (!this.config.allowWrites) throw new WorkItemsError('write-disabled', 'GitLab writes are disabled')
    if (mutation.kind === 'create') {
      if (mutation.source !== 'gitlab') throw new WorkItemsError('invalid-request', 'Wrong Work Items source')
    } else {
      this.issueIid(mutation.id)
      if (mutation.kind === 'state' && mutation.state !== 'opened' && mutation.state !== 'closed') {
        throw new WorkItemsError('invalid-request', 'GitLab state must be opened or closed')
      }
      if (mutation.kind === 'assign' && mutation.assignees.some(username => !/^[a-zA-Z0-9._-]{1,255}$/.test(username))) {
        throw new WorkItemsError('invalid-request', 'Invalid GitLab assignee username')
      }
    }
  }

  private async executeMutation(mutation: WorkItemMutation, signal?: AbortSignal): Promise<WorkItemMutationResult> {
    this.validateMutation(mutation, signal)
    const base = '/api/v4/projects/' + projectPath(this.config) + '/issues'
    if (mutation.kind === 'create') {
      const item = mapIssue(await this.request(base, signal, { method: 'POST', body: { title: mutation.title, description: mutation.body } }), this.config)
      return { itemId: item.id, url: item.url }
    }
    const iid = this.issueIid(mutation.id)
    const path = base + '/' + iid
    if (mutation.kind === 'comment') {
      await this.request(path + '/notes', signal, { method: 'POST', body: { body: mutation.body } })
      return { itemId: mutation.id, url: this.config.origin + '/' + this.config.owner + '/' + this.config.repository + '/-/issues/' + iid }
    }
    const body = mutation.kind === 'state' ? { state_event: mutation.state === 'closed' ? 'close' : 'reopen' } : { assignee_ids: [] }
    const item = mapIssue(await this.request(path, signal, { method: 'PUT', body }), this.config)
    if (item.id !== mutation.id) throw new WorkItemsError('invalid-response', 'GitLab returned a different issue')
    return { itemId: item.id, url: item.url }
  }

  /** Stop future provider operations. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.lifecycle.abort()
  }
}

/** Register the configured GitLab provider. */
export function apply(ctx: Context, config: Config = {}): void {
  const provider = new GitLabWorkItemsProvider(ctx, resolveGitLabWorkItemsConfig(config))
  ctx.effect(() => ctx.workItems.registerProvider(provider), 'work-items-gitlab: provider')
}
